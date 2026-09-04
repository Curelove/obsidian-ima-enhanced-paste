const { Plugin, Notice, requestUrl } = require("obsidian");

const IMA_MIME_TYPE = "application/x-ima-fragment";
const IMAGE_FOLDER = "IMA Images";

class ImaEnhancedPastePlugin extends Plugin {
    async onload() {
        this.registerDomEvent(
            document,
            "paste",
            (event) => this.handlePaste(event),
            true
        );

        this.addCommand({
            id: "paste-from-ima-clipboard",
            name: "从 IMA 剪贴板粘贴",
            checkCallback: (checking) => {
                const editor = this.getActiveEditor();

                if (!editor) {
                    return false;
                }

                if (!checking) {
                    this.pasteFromImaClipboard(editor);
                }

                return true;
            }
        });

        this.addCommand({
            id: "clean-ima-export-placeholders",
            name: "清理 IMA 导出空行占位符",
            editorCallback: (editor) => {
                const content = editor.getValue();

                const cleaned = content.replace(
                    /^[ \t]*&#x20;\\?[ \t]*$/gm,
                    ""
                );

                if (cleaned !== content) {
                    editor.setValue(cleaned);
                    new Notice("已清理 IMA 导出空行占位符");
                } else {
                    new Notice("没有找到 IMA 导出空行占位符");
                }
            }
        });

        console.log("IMA Enhanced Paste loaded");
    }

    onunload() {
        console.log("IMA Enhanced Paste unloaded");
    }

    getActiveEditor() {
        const activeEditor = this.app.workspace.activeEditor;

        if (!activeEditor || !activeEditor.editor) {
            return null;
        }

        return activeEditor.editor;
    }

    getEventElements(event) {
        const elements = [];

        if (event && typeof event.composedPath === "function") {
            for (const item of event.composedPath()) {
                if (item instanceof Element) {
                    elements.push(item);
                }
            }
        }

        if (event && event.target instanceof Element) {
            elements.push(event.target);
        }

        if (document.activeElement instanceof Element) {
            elements.push(document.activeElement);
        }

        return elements;
    }

    isInsideProperties(event) {
        const selectors = [
            ".metadata-container",
            ".metadata-properties",
            ".metadata-property",
            ".metadata-property-key",
            ".metadata-property-value",
            ".metadata-input",
            ".metadata-input-longtext",
            ".metadata-property-value-content",
            ".metadata-property-value-wrapper",
            ".metadata-property-value-edit",
            "[data-property-key]",
            "[data-property-name]",
            "[data-property-type]",
            "[data-property-value]"
        ].join(", ");

        return this.getEventElements(event).some((element) => {
            return Boolean(element.closest(selectors));
        });
    }

    isTextInputTarget(event) {
        const selector = "input, textarea, select, button";

        return this.getEventElements(event).some((element) => {
            return element.matches(selector) ||
                Boolean(element.closest(selector));
        });
    }

    isMarkdownEditorTarget(event) {
        if (this.isInsideProperties(event)) {
            return false;
        }

        if (this.isTextInputTarget(event)) {
            return false;
        }

        const target = event ? event.target : null;

        if (!(target instanceof Element)) {
            return false;
        }

        return Boolean(
            target.closest(
                ".cm-editor, .markdown-source-view, .markdown-preview-view"
            )
        );
    }

    getInlineTitleElement(event) {
        const selector = [
            ".inline-title",
            ".inline-title-input",
            "[data-inline-title]"
        ].join(", ");

        for (const element of this.getEventElements(event)) {
            const titleElement = element.closest(selector);

            if (titleElement) {
                return titleElement;
            }
        }

        return null;
    }

    isInlineTitleTarget(event) {
        return Boolean(this.getInlineTitleElement(event));
    }

    handlePaste(event) {
        if (!event || event.defaultPrevented || !event.clipboardData) {
            return;
        }

        if (this.isInsideProperties(event)) {
            return;
        }

        const isTitleTarget = this.isInlineTitleTarget(event);
        const isBodyTarget = this.isMarkdownEditorTarget(event);

        if (!isTitleTarget && !isBodyTarget) {
            return;
        }

        const types = Array.from(event.clipboardData.types || []);

        if (!types.includes(IMA_MIME_TYPE)) {
            return;
        }

        const encodedData = event.clipboardData.getData(IMA_MIME_TYPE);

        if (!encodedData) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (isTitleTarget) {
            this.pasteImaTitle(encodedData, event);
            return;
        }

        const editor = this.getActiveEditor();

        if (!editor) {
            return;
        }

        const selection = {
            from: editor.getCursor("from"),
            to: editor.getCursor("to")
        };

        this.pasteImaData(encodedData, editor, selection);
    }

    async pasteImaData(encodedData, editor, selection) {
        try {
            this.imageFailureCount = 0;
            this.tableCount = 0;

            const imaData = this.decodeImaData(encodedData);
            const markdown = await this.convertImaToMarkdown(imaData);

            if (!markdown) {
                throw new Error("IMA 内容为空");
            }

            editor.replaceRange(
                markdown,
                selection.from,
                selection.to
            );

            if (this.imageFailureCount > 0) {
                new Notice(
                    "已按 IMA 格式粘贴；" +
                    this.imageFailureCount +
                    " 张图片下载失败，已保留临时网络链接"
                );
            } else if (this.tableCount > 0) {
                new Notice(
                    "已按 IMA 格式粘贴；表格已尽量保留，" +
                    "但在 Obsidian 中为静态 HTML 表格，" +
                    "不能像原生表格一样直接交互编辑"
                );
            } else {
                new Notice("已按 IMA 格式粘贴");
            }
        } catch (error) {
            console.error(
                "IMA Enhanced Paste parsing failed:",
                error
            );

            new Notice("IMA 内容解析失败，未插入内容");
        }
    }

    async pasteImaTitle(encodedData, event) {
        try {
            const imaData = this.decodeImaData(encodedData);
            const titleText = this.convertImaToTitleText(imaData);

            if (!titleText) {
                throw new Error("IMA 标题内容为空");
            }

            const titleElement = this.getInlineTitleElement(event);

            if (!titleElement) {
                throw new Error("找不到 Obsidian 内联标题输入区域");
            }

            titleElement.focus();

            if (
                titleElement instanceof HTMLInputElement ||
                titleElement instanceof HTMLTextAreaElement
            ) {
                const start = titleElement.selectionStart ??
                    titleElement.value.length;

                const end = titleElement.selectionEnd ?? start;

                titleElement.setRangeText(
                    titleText,
                    start,
                    end,
                    "end"
                );

                titleElement.dispatchEvent(
                    new Event("input", { bubbles: true })
                );
            } else {
                const inserted = document.execCommand(
                    "insertText",
                    false,
                    titleText
                );

                if (!inserted) {
                    throw new Error("无法将文字插入标题");
                }
            }

            new Notice("已按 IMA 格式粘贴到标题");
        } catch (error) {
            console.error("IMA title paste failed:", error);
            new Notice("IMA 内容无法粘贴到标题");
        }
    }

    convertImaToTitleText(nodes) {
        return nodes
            .map((node) => this.extractPlainText(node))
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    extractPlainText(node) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (
            node.type === "cloud_image" ||
            node.type === "image" ||
            node.type === "inline_equation"
        ) {
            return "";
        }

        if (typeof node.text === "string") {
            return node.text;
        }

        if (!Array.isArray(node.children)) {
            return "";
        }

        return node.children
            .map((child) => this.extractPlainText(child))
            .join("");
    }

    pasteFromImaClipboard(editor) {
        navigator.clipboard
            .read()
            .then(async (clipboardItems) => {
                let encodedData = null;

                for (const item of clipboardItems) {
                    if (!item.types.includes(IMA_MIME_TYPE)) {
                        continue;
                    }

                    const blob = await item.getType(IMA_MIME_TYPE);
                    encodedData = await blob.text();
                    break;
                }

                if (!encodedData) {
                    new Notice("当前剪贴板中没有 IMA 内容");
                    return;
                }

                const selection = {
                    from: editor.getCursor("from"),
                    to: editor.getCursor("to")
                };

                await this.pasteImaData(
                    encodedData,
                    editor,
                    selection
                );
            })
            .catch((error) => {
                console.error(
                    "IMA Enhanced Paste command failed:",
                    error
                );

                new Notice("读取 IMA 剪贴板失败");
            });
    }

    decodeImaData(encodedData) {
        let decodedText = encodedData;

        try {
            decodedText = this.decodeBase64Utf8(decodedText);
        } catch (error) {
            decodedText = encodedData;
        }

        try {
            decodedText = decodeURIComponent(decodedText);
        } catch (error) {
            console.warn(
                "IMA 数据 URL 解码失败，继续尝试解析原始内容:",
                error
            );
        }

        const data = JSON.parse(decodedText);

        if (!Array.isArray(data)) {
            throw new Error("IMA 数据不是节点数组");
        }

        return data;
    }

    decodeBase64Utf8(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new TextDecoder("utf-8").decode(bytes);
    }

    async convertImaToMarkdown(nodes) {
        const blocks = [];

        for (const node of nodes) {
            const block = await this.renderBlock(node);

            if (block !== null) {
                blocks.push(block);
            }
        }

        while (
            blocks.length > 0 &&
            blocks[blocks.length - 1] === ""
        ) {
            blocks.pop();
        }

        return blocks.join("\n\n");
    }

    async renderBlock(node) {
        if (!node || typeof node !== "object") {
            return null;
        }

        const type = node.type || "p";
        const children = Array.isArray(node.children)
            ? node.children
            : [];

        if (type === "cloud_image") {
            return this.renderCloudImage(node);
        }

        if (type === "cursor-side") {
            return this.renderChildren(children);
        }

        if (type === "table") {
            return this.renderTable(node);
        }

        if (type === "hr") {
            return "---";
        }

        if (type === "code_block") {
            return this.renderCodeBlock(node);
        }

        if (type === "action_item") {
            return this.renderActionItem(node);
        }

        if (type === "inline_equation") {
            return "";
        }

        if (type === "tr" || type === "td") {
            return this.renderChildren(children);
        }

        const content = await this.renderChildren(children);

        if (!content && children.length === 0) {
            return "";
        }

        if (type === "h1") {
            return "# " + this.removeLeadingHeadingMarks(content);
        }

        if (type === "h2") {
            return "## " + this.removeLeadingHeadingMarks(content);
        }

        if (type === "h3") {
            return "### " + this.removeLeadingHeadingMarks(content);
        }

        if (type === "h4") {
            return "#### " + this.removeLeadingHeadingMarks(content);
        }

        if (type === "h5") {
            return "##### " + this.removeLeadingHeadingMarks(content);
        }

        if (type === "h6") {
            return "###### " + this.removeLeadingHeadingMarks(content);
        }

        if (type === "blockquote") {
            return content
                .split("\n")
                .map((line) => "> " + line)
                .join("\n");
        }

        if (node.listStyleType === "disc") {
            return this.renderListItem(node, "-", content);
        }

        if (node.listStyleType === "decimal") {
            const number = Number.isFinite(node.listStart)
                ? node.listStart
                : 1;

            return this.renderListItem(
                node,
                number + ".",
                content
            );
        }

        return this.applyBlockAlignment(content, node.align);
    }

    async renderChildren(children) {
        let content = "";

        for (const child of children) {
            content += await this.renderInline(child);
        }

        return content;
    }

    async renderInline(node) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (node.type === "cloud_image") {
            return this.renderCloudImage(node);
        }

        if (node.type === "inline_equation") {
            return "";
        }

        if (node.type === "code_line") {
            return this.renderChildren(
                Array.isArray(node.children) ? node.children : []
            );
        }

        if (node.type === "a") {
            const children = Array.isArray(node.children)
                ? node.children
                : [];

            const label = await this.renderChildren(children);
            const url = typeof node.url === "string"
                ? node.url
                : "";

            if (!url) {
                return this.applyInlineStyles(label, node);
            }

            const link =
                "<a href=\"" +
                this.escapeHtmlAttribute(url) +
                "\">" +
                label +
                "</a>";

            return this.applyInlineStyles(link, node);
        }

        let content = "";

        if (Array.isArray(node.children)) {
            content = await this.renderChildren(node.children);
        } else if (typeof node.text === "string") {
            content = this.normalizeTextLineBreaks(node.text);
        }

        return this.applyInlineStyles(content, node);
    }

    async renderTable(tableNode) {
        this.tableCount = (this.tableCount || 0) + 1;

        const rows = this.findNodesByType(
            tableNode.children || [],
            "tr"
        );

        if (rows.length === 0) {
            return "";
        }

        const colSizes = this.getTableColumnSizes(tableNode);
        const columns = colSizes.map((width) => {
            const size = Number(width);

            if (!Number.isFinite(size) || size <= 0) {
                return "<col>";
            }

            return "<col style=\"width:" +
                size +
                "px;\">";
        });

        const renderedRows = [];

        for (const row of rows) {
            const cells = Array.isArray(row.children)
                ? row.children.filter((child) => {
                    return child && child.type === "td";
                })
                : [];

            const renderedCells = [];

            for (const cell of cells) {
                const cellContent =
                    await this.renderTableCell(cell);

                renderedCells.push(
                    "<td>" + cellContent + "</td>"
                );
            }

            let rowStyle = "";
            const rowHeight = this.getTableRowHeight(row);

            if (Number.isFinite(rowHeight) && rowHeight > 0) {
                rowStyle =
                    " style=\"height:" +
                    rowHeight +
                    "px;\"";
            }

            renderedRows.push(
                "<tr" +
                rowStyle +
                ">" +
                renderedCells.join("") +
                "</tr>"
            );
        }

        const parts = ["<table>"];

        if (columns.length > 0) {
            parts.push("<colgroup>");
            parts.push(columns.join(""));
            parts.push("</colgroup>");
        }

        parts.push("<tbody>");
        parts.push(renderedRows.join("\n"));
        parts.push("</tbody>");
        parts.push("</table>");

        return parts.join("\n");
    }

    getTableColumnSizes(tableNode) {
        const candidates = [
            tableNode.colSizes,
            tableNode.colWidths,
            tableNode.columnWidths,
            tableNode.widths
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate)) {
                return candidate;
            }

            if (typeof candidate === "string") {
                const values = candidate
                    .split(/[,\s]+/)
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value));

                if (values.length > 0) {
                    return values;
                }
            }
        }

        return [];
    }

    getTableRowHeight(row) {
        const candidates = [
            row.size,
            row.height,
            row.rowHeight
        ];

        for (const candidate of candidates) {
            const value = Number(candidate);

            if (Number.isFinite(value) && value > 0) {
                return value;
            }
        }

        return 0;
    }

    findNodesByType(nodes, type) {
        const found = [];

        for (const node of nodes) {
            if (!node || typeof node !== "object") {
                continue;
            }

            if (node.type === type) {
                found.push(node);
                continue;
            }

            if (Array.isArray(node.children)) {
                found.push(
                    ...this.findNodesByType(node.children, type)
                );
            }
        }

        return found;
    }

    async renderTableCell(cellNode) {
        const children = Array.isArray(cellNode.children)
            ? cellNode.children
            : [];

        const parts = [];

        for (const child of children) {
            if (!child || typeof child !== "object") {
                continue;
            }

            const content = await this.renderTableInline(child);

            if (content) {
                parts.push(content);
            }
        }

        if (parts.length === 0) {
            return "&nbsp;";
        }

        return parts.join("<br>");
    }

    async renderTableInline(node) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (node.type === "cloud_image") {
            return this.renderCloudImage(node);
        }

        if (node.type === "inline_equation") {
            return "";
        }

        if (node.type === "a") {
            const children = Array.isArray(node.children)
                ? node.children
                : [];

            const label = await this.renderTableChildren(children);
            const url = typeof node.url === "string"
                ? node.url
                : "";

            if (!url) {
                return this.applyTableInlineStyles(label, node);
            }

            const link =
                "<a href=\"" +
                this.escapeHtmlAttribute(url) +
                "\">" +
                label +
                "</a>";

            return this.applyTableInlineStyles(link, node);
        }

        if (Array.isArray(node.children)) {
            const content = await this.renderTableChildren(
                node.children
            );

            return this.applyTableInlineStyles(content, node);
        }

        if (typeof node.text !== "string") {
            return "";
        }

        const text = this.escapeHtml(node.text)
            .replace(/\r\n/g, "<br>")
            .replace(/\r/g, "<br>")
            .replace(/\n/g, "<br>");

        return this.applyTableInlineStyles(text, node);
    }

    async renderTableChildren(children) {
        let content = "";

        for (const child of children) {
            content += await this.renderTableInline(child);
        }

        return content;
    }

    applyTableInlineStyles(content, node) {
        return this.applyHtmlInlineStyles(content, node);
    }

    async renderCodeBlock(node) {
        const codeLines = this.findNodesByType(
            node.children || [],
            "code_line"
        );

        let code = "";

        if (codeLines.length > 0) {
            const lines = [];

            for (const line of codeLines) {
                lines.push(this.extractPlainText(line));
            }

            code = lines.join("\n");
        } else {
            code = this.extractPlainText(node);
        }

        return "```\n" + code + "\n```";
    }

    async renderActionItem(node) {
        const content = await this.renderChildren(
            Array.isArray(node.children) ? node.children : []
        );

        const indent = Number.isFinite(node.indent)
            ? "    ".repeat(Math.max(0, node.indent - 1))
            : "";

        const checked = node.checked ? "x" : " ";

        return indent + "- [" + checked + "] " + content;
    }

    renderListItem(node, marker, content) {
        const indent = Number.isFinite(node.indent)
            ? "    ".repeat(Math.max(0, node.indent - 1))
            : "";

        return indent + marker + " " + content;
    }

    normalizeTextLineBreaks(text) {
        return text
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/\n/g, "<br>");
    }

    applyInlineStyles(content, node) {
        return this.applyHtmlInlineStyles(content, node);
    }

    applyHtmlInlineStyles(content, node) {
        if (!content) {
            return "";
        }

        let result = content;

        /*
         * 使用 HTML 标签而不是 Markdown 的 **、*、~~。
         * 这样可以避免中文标点后出现孤立的 Markdown 标记。
         */
        if (node.bold) {
            result = "<strong>" + result + "</strong>";
        }

        if (node.italic) {
            result = "<em>" + result + "</em>";
        }

        if (node.underline) {
            result = "<u>" + result + "</u>";
        }

        if (node.strikethrough) {
            result = "<s>" + result + "</s>";
        }

        const backgroundColor = this.getUsableColor(
            node.backgroundColor,
            true
        );

        if (backgroundColor) {
            result =
                "<mark style=\"background-color:" +
                this.escapeHtmlAttribute(backgroundColor) +
                ";\">" +
                result +
                "</mark>";
        }

        const color = this.getUsableColor(
            node.color,
            false
        );

        if (color) {
            result =
                "<span style=\"color:" +
                this.escapeHtmlAttribute(color) +
                ";\">" +
                result +
                "</span>";
        }

        return result;
    }

    getUsableColor(color, isBackground) {
        if (typeof color !== "string") {
            return "";
        }

        const normalized = color.trim();

        if (!normalized) {
            return "";
        }

        const variableColors = {
            "var(--common_color_yellow)": "#FFCC1A"
        };

        if (variableColors[normalized]) {
            return variableColors[normalized];
        }

        if (
            normalized.startsWith("var(") &&
            normalized.endsWith(")")
        ) {
            return "";
        }

        const shortHex = normalized.match(
            /^#([0-9a-fA-F]{3})$/
        );

        if (shortHex) {
            return this.expandShortHexColor(normalized);
        }

        if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
            return normalized.toUpperCase();
        }

        const hex8 = this.convertHex8ToRgba(normalized);

        if (hex8) {
            return hex8;
        }

        const rgb = this.normalizeRgbColor(normalized);

        if (rgb) {
            return rgb;
        }

        const hsl = this.normalizeHslColor(normalized);

        if (hsl) {
            return hsl;
        }

        const namedColors = [
            "red",
            "orange",
            "yellow",
            "green",
            "blue",
            "purple",
            "pink",
            "gray",
            "grey",
            "black",
            "white"
        ];

        if (
            namedColors.includes(
                normalized.toLowerCase()
            )
        ) {
            return normalized.toLowerCase();
        }

        return "";
    }

    expandShortHexColor(color) {
        const red = color.charAt(1);
        const green = color.charAt(2);
        const blue = color.charAt(3);

        return (
            "#" +
            red + red +
            green + green +
            blue + blue
        ).toUpperCase();
    }

    convertHex8ToRgba(color) {
        const match = color.match(
            /^#([0-9a-fA-F]{8})$/
        );

        if (!match) {
            return "";
        }

        const hex = match[1];

        const red = parseInt(hex.slice(0, 2), 16);
        const green = parseInt(hex.slice(2, 4), 16);
        const blue = parseInt(hex.slice(4, 6), 16);
        const alpha = parseInt(hex.slice(6, 8), 16) / 255;

        if (alpha >= 0.999) {
            return (
                "#" +
                hex.slice(0, 6)
            ).toUpperCase();
        }

        return (
            "rgba(" +
            red +
            ", " +
            green +
            ", " +
            blue +
            ", " +
            alpha.toFixed(3) +
            ")"
        );
    }

    normalizeRgbColor(color) {
        const value = String(color)
            .trim()
            .replace(/\s+$/, "");

        const repaired = this.repairRgbColor(value);

        if (!repaired) {
            return "";
        }

        const match = repaired.match(
            /^rgba?\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*\)$/i
        );

        if (!match) {
            return "";
        }

        const red = Number(match[1]);
        const green = Number(match[2]);
        const blue = Number(match[3]);
        const alpha = match[4] === undefined
            ? 1
            : Number(match[4]);

        if (
            !this.isValidRgbChannel(red) ||
            !this.isValidRgbChannel(green) ||
            !Number.isFinite(alpha) ||
            alpha < 0 ||
            alpha > 1
        ) {
            return "";
        }

        if (alpha >= 0.999) {
            return this.rgbToHex(red, green, blue);
        }

        return (
            "rgba(" +
            red +
            ", " +
            green +
            ", " +
            blue +
            ", " +
            alpha.toFixed(3) +
            ")"
        );
    }

    repairRgbColor(color) {
        const value = String(color).trim();

        const completePattern =
            /^(rgba?)\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*\)$/i;

        if (completePattern.test(value)) {
            return value;
        }

        const missingClosingBracket = value.match(
            /^(rgba?)\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*$/i
        );

        if (!missingClosingBracket) {
            return "";
        }

        return (
            missingClosingBracket[1] +
            "(" +
            missingClosingBracket[2] +
            ", " +
            missingClosingBracket[3] +
            ", " +
            missingClosingBracket[4] +
            (
                missingClosingBracket[5] === undefined
                    ? ""
                    : ", " + missingClosingBracket[5]
            ) +
            ")"
        );
    }

    isValidRgbChannel(value) {
        return Number.isFinite(value) &&
            value >= 0 &&
            value <= 255;
    }

    rgbToHex(red, green, blue) {
        const toHex = (value) => {
            return Math.round(value)
                .toString(16)
                .padStart(2, "0");
        };

        return (
            "#" +
            toHex(red) +
            toHex(green) +
            toHex(blue)
        ).toUpperCase();
    }

    normalizeHslColor(color) {
        const value = String(color).trim();

        const match = value.match(
            /^(hsla?)\(\s*([-+]?(?:\d+(?:\.\d+)?))\s*(deg|grad|rad|turn)?\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i
        );

        if (!match) {
            return "";
        }

        const saturation = Number(match[4]);
        const lightness = Number(match[5]);

        if (
            !Number.isFinite(saturation) ||
            !Number.isFinite(lightness) ||
            saturation < 0 ||
            saturation > 100 ||
            lightness < 0 ||
            lightness > 100
        ) {
            return "";
        }

        if (match[6] === undefined) {
            return value;
        }

        const alpha = Number(match[6]);

        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
            return "";
        }

        return value;
    }

    applyBlockAlignment(content, align) {
        const alignments = {
            center: "center",
            right: "right",
            justify: "justify"
        };

        if (!alignments[align]) {
            return content;
        }

        return (
            "<div style=\"text-align:" +
            alignments[align] +
            ";\">" +
            content +
            "</div>"
        );
    }

    async renderCloudImage(node) {
        const url = typeof node.url === "string"
            ? node.url
            : "";

        if (!url) {
            this.imageFailureCount += 1;

            return "> [!warning] IMA 图片没有可用地址";
        }

        try {
            const imagePath = await this.downloadImage(url);

            return "![" +
                this.escapeMarkdownAlt("IMA 图片") +
                "](" +
                this.escapeLinkUrl(
                    this.app.vault.adapter.getResourcePath(imagePath)
                ) +
                ")";
        } catch (error) {
            console.error("IMA image download failed:", error);

            this.imageFailureCount += 1;

            return "![" +
                this.escapeMarkdownAlt("IMA 图片（下载失败）") +
                "](" +
                this.escapeLinkUrl(url) +
                ")";
        }
    }

    async downloadImage(url) {
        await this.ensureImageFolder();

        const extension = this.getImageExtension(url, "");
        const fileName = await this.createImageFileName(
            url,
            extension
        );

        const imagePath = IMAGE_FOLDER + "/" + fileName;

        if (await this.app.vault.adapter.exists(imagePath)) {
            return imagePath;
        }

        const response = await requestUrl({
            url: url,
            method: "GET",
            throw: true
        });

        await this.app.vault.adapter.writeBinary(
            imagePath,
            response.arrayBuffer
        );

        return imagePath;
    }

    async ensureImageFolder() {
        const adapter = this.app.vault.adapter;

        if (await adapter.exists(IMAGE_FOLDER)) {
            return;
        }

        try {
            await this.app.vault.createFolder(IMAGE_FOLDER);
        } catch (error) {
            if (!(await adapter.exists(IMAGE_FOLDER))) {
                throw error;
            }
        }
    }

    async createImageFileName(url, extension) {
        const stableUrl = this.getStableImageUrl(url);
        const hash = this.hashText(stableUrl);

        return "ima-image-" + hash + "." + extension;
    }

    getStableImageUrl(url) {
        try {
            const parsedUrl = new URL(url);

            return parsedUrl.origin + parsedUrl.pathname;
        } catch (error) {
            return String(url).split("?")[0];
        }
    }

    hashText(text) {
        let hash = 2166136261;

        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0)
            .toString(16)
            .padStart(8, "0");
    }

    getImageExtension(url, contentType) {
        const normalizedType = String(contentType || "")
            .toLowerCase()
            .split(";")[0]
            .trim();

        const extensions = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
            "image/avif": "avif",
            "image/svg+xml": "svg"
        };

        if (extensions[normalizedType]) {
            return extensions[normalizedType];
        }

        try {
            const pathname = new URL(url).pathname;
            const match = pathname.match(
                /\.([a-zA-Z0-9]{2,5})$/
            );

            if (match) {
                return match[1].toLowerCase();
            }
        } catch (error) {
            console.warn(
                "Unable to determine image extension:",
                error
            );
        }

        return "png";
    }

    removeLeadingHeadingMarks(text) {
        return text.replace(/^[#\s]+/, "");
    }

    escapeLinkUrl(url) {
        return String(url)
            .replace(/\\/g, "\\\\")
            .replace(/\)/g, "\\)");
    }

    escapeMarkdownAlt(text) {
        return String(text)
            .replace(/\[/g, "\\[")
            .replace(/\]/g, "\\]");
    }

    escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    escapeHtmlAttribute(text) {
        return this.escapeHtml(text);
    }
}

module.exports = ImaEnhancedPastePlugin;
