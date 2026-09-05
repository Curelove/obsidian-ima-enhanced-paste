const {
    Plugin,
    Notice,
    PluginSettingTab,
    Setting,
    Modal,
    MarkdownView,
    requestUrl
} = require("obsidian");

const IMA_MIME_TYPE = "application/x-ima-fragment";
const IMAGE_FOLDER = "IMA Images";
const RICH_PASTE_ATTRIBUTE = "data-rich-paste";

const FORMAT_HTML = "html";
const FORMAT_MARKDOWN = "markdown";
const FORMAT_MARKDOWN_PRIORITY = "markdown-priority";

const DEFAULT_SETTINGS = {
    pasteSource: "ima",
    pasteFormat: FORMAT_HTML,
    conversionFormat: FORMAT_MARKDOWN,
    convertScope: "plugin-and-legacy",
    showConversionRibbon: true,
    confirmBeforeConversion: true,
    showTableNotice: true,
    useHtmlEmphasisInMarkdown: false,
    imageFolder: IMAGE_FOLDER
};

class ImaEnhancedPastePlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.imageFailureCount = 0;
        this.tableCount = 0;
        this.ribbonIconEl = null;

        this.addSettingTab(
            new RichPasteSettingTab(this.app, this)
        );

        this.updateConversionRibbon();

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
            id: "open-current-note-conversion",
            name: "转换当前笔记格式",
            checkCallback: (checking) => {
                if (!this.getActiveMarkdownView()) {
                    return false;
                }

                if (!checking) {
                    this.openCurrentNoteConversion();
                }

                return true;
            }
        });

        this.addCommand({
            id: "convert-current-note-to-markdown",
            name: "将当前笔记转换为 Markdown 兼容格式",
            checkCallback: (checking) => {
                if (!this.getActiveMarkdownView()) {
                    return false;
                }

                if (!checking) {
                    this.openCurrentNoteConversion(
                        FORMAT_MARKDOWN
                    );
                }

                return true;
            }
        });

        this.addCommand({
            id: "convert-current-note-to-markdown-priority",
            name: "将当前笔记转换为 Markdown 优先格式",
            checkCallback: (checking) => {
                if (!this.getActiveMarkdownView()) {
                    return false;
                }

                if (!checking) {
                    this.openCurrentNoteConversion(
                        FORMAT_MARKDOWN_PRIORITY
                    );
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

                if (cleaned === content) {
                    new Notice("没有找到 IMA 导出空行占位符");
                    return;
                }

                editor.setValue(cleaned);
                new Notice("已清理 IMA 导出空行占位符");
            }
        });

        this.addCommand({
            id: "repair-old-rich-paste-image-links",
            name: "修复所有笔记中的旧富文本图片地址",
            callback: () => {
                this.repairAllNoteImageLinks();
            }
        });

        this.registerDomEvent(
            document,
            "paste",
            (event) => this.handlePaste(event),
            true
        );

        console.log("IMA Enhanced Paste loaded");
    }

    onunload() {
        this.removeConversionRibbon();
        console.log("IMA Enhanced Paste unloaded");
    }

    async loadSettings() {
        const savedSettings = await this.loadData();

        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            savedSettings || {}
        );

        if (!this.settings.imageFolder) {
            this.settings.imageFolder = IMAGE_FOLDER;
        }

        if (!this.isValidFormat(this.settings.pasteFormat)) {
            this.settings.pasteFormat = FORMAT_HTML;
        }

        if (
            !this.isConversionFormat(
                this.settings.conversionFormat
            )
        ) {
            this.settings.conversionFormat = FORMAT_MARKDOWN;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    isValidFormat(format) {
        return [
            FORMAT_HTML,
            FORMAT_MARKDOWN,
            FORMAT_MARKDOWN_PRIORITY
        ].includes(format);
    }

    isConversionFormat(format) {
        return [
            FORMAT_MARKDOWN,
            FORMAT_MARKDOWN_PRIORITY
        ].includes(format);
    }

    getPasteFormat() {
        if (this.isValidFormat(this.settings.pasteFormat)) {
            return this.settings.pasteFormat;
        }

        return FORMAT_HTML;
    }

    getConversionFormat(overrideFormat) {
        if (this.isConversionFormat(overrideFormat)) {
            return overrideFormat;
        }

        if (
            this.isConversionFormat(
                this.settings.conversionFormat
            )
        ) {
            return this.settings.conversionFormat;
        }

        return FORMAT_MARKDOWN;
    }

    getImageFolder() {
        return this.settings.imageFolder || IMAGE_FOLDER;
    }

    getActiveMarkdownView() {
        const view = this.app.workspace.getActiveViewOfType(
            MarkdownView
        );

        if (!view || !view.editor) {
            return null;
        }

        return view;
    }

    getActiveEditor() {
        const view = this.getActiveMarkdownView();

        return view ? view.editor : null;
    }

    updateConversionRibbon() {
        if (this.settings.showConversionRibbon) {
            this.createConversionRibbon();
            return;
        }

        this.removeConversionRibbon();
    }

    createConversionRibbon() {
        if (this.ribbonIconEl) {
            return;
        }

        this.ribbonIconEl = this.addRibbonIcon(
            "file-cog",
            "转换当前笔记格式",
            () => this.openCurrentNoteConversion()
        );
    }

    removeConversionRibbon() {
        if (!this.ribbonIconEl) {
            return;
        }

        this.ribbonIconEl.remove();
        this.ribbonIconEl = null;
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
        if (
            this.isInsideProperties(event) ||
            this.isTextInputTarget(event)
        ) {
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
        const selectors = [
            ".inline-title",
            ".inline-title-input",
            "[data-inline-title]"
        ].join(", ");

        for (const element of this.getEventElements(event)) {
            const titleElement = element.closest(selectors);

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
        if (
            !event ||
            event.defaultPrevented ||
            !event.clipboardData ||
            this.isInsideProperties(event)
        ) {
            return;
        }

        const isTitleTarget = this.isInlineTitleTarget(event);
        const isBodyTarget = this.isMarkdownEditorTarget(event);

        if (!isTitleTarget && !isBodyTarget) {
            return;
        }

        const types = Array.from(
            event.clipboardData.types || []
        );

        const source = this.getClipboardSource(
            types.includes(IMA_MIME_TYPE),
            types.includes("text/html")
        );

        if (!source) {
            return;
        }

        const encodedImaData = source === "ima"
            ? event.clipboardData.getData(IMA_MIME_TYPE)
            : "";

        const htmlData = source === "html"
            ? event.clipboardData.getData("text/html")
            : "";

        if (!encodedImaData && !htmlData) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (isTitleTarget) {
            if (source === "ima") {
                this.pasteImaTitle(encodedImaData, event);
            }

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

        if (source === "ima") {
            this.pasteImaData(
                encodedImaData,
                editor,
                selection
            );

            return;
        }

        this.pasteHtmlData(htmlData, editor, selection);
    }

    getClipboardSource(hasImaData, hasHtmlData) {
        if (this.settings.pasteSource === "ima") {
            return hasImaData ? "ima" : "";
        }

        if (this.settings.pasteSource === "html") {
            return hasHtmlData ? "html" : "";
        }

        if (this.settings.pasteSource === "auto") {
            if (hasImaData) {
                return "ima";
            }

            return hasHtmlData ? "html" : "";
        }

        return "";
    }

    createRichPasteAttribute() {
        return RICH_PASTE_ATTRIBUTE + "=\"1\"";
    }

    shouldUseSafeEmphasis() {
        return this.settings.useHtmlEmphasisInMarkdown === true;
    }

    wrapStrong(content) {
        if (!content) {
            return "";
        }

        if (this.shouldUseSafeEmphasis()) {
            return "<strong>" + content + "</strong>";
        }

        return "**" + content + "**";
    }

    wrapEmphasis(content) {
        if (!content) {
            return "";
        }

        if (this.shouldUseSafeEmphasis()) {
            return "<em>" + content + "</em>";
        }

        return "*" + content + "*";
    }

    wrapStrikethrough(content) {
        if (!content) {
            return "";
        }

        if (this.shouldUseSafeEmphasis()) {
            return "<s>" + content + "</s>";
        }

        return "~~" + content + "~~";
    }

        async pasteImaData(encodedData, editor, selection) {
        try {
            this.imageFailureCount = 0;
            this.tableCount = 0;

            const imaData = this.decodeImaData(encodedData);

            if (this.imaDataContainsImages(imaData)) {
                new Notice(
                    "正在处理 IMA 图片，请稍候……"
                );
            }

            const output = await this.convertImaToOutput(imaData);

            if (!output || !output.trim()) {
                throw new Error("IMA 内容为空");
            }

            editor.replaceRange(
                output,
                selection.from,
                selection.to
            );

            this.showPasteResultNotice();
        } catch (error) {
            console.error(
                "IMA Enhanced Paste parsing failed:",
                error
            );

            new Notice(
                "IMA 内容解析失败，未插入内容"
            );
        }
    }

    async pasteImaTitle(encodedData, event) {
        try {
            const imaData = this.decodeImaData(encodedData);
            const titleText = this.convertImaToTitleText(
                imaData
            );

            if (!titleText) {
                throw new Error(
                    "IMA 标题内容为空"
                );
            }

            const titleElement = this.getInlineTitleElement(
                event
            );

            if (!titleElement) {
                throw new Error(
                    "找不到 Obsidian 内联标题输入区域"
                );
            }

            titleElement.focus();

            if (
                titleElement instanceof HTMLInputElement ||
                titleElement instanceof HTMLTextAreaElement
            ) {
                const start =
                    titleElement.selectionStart ??
                    titleElement.value.length;

                const end =
                    titleElement.selectionEnd ??
                    start;

                titleElement.setRangeText(
                    titleText,
                    start,
                    end,
                    "end"
                );

                titleElement.dispatchEvent(
                    new Event("input", {
                        bubbles: true
                    })
                );
            } else {
                const inserted = document.execCommand(
                    "insertText",
                    false,
                    titleText
                );

                if (!inserted) {
                    throw new Error(
                        "无法将文字插入标题"
                    );
                }
            }

            new Notice(
                "已按 IMA 格式粘贴到标题"
            );
        } catch (error) {
            console.error(
                "IMA title paste failed:",
                error
            );

            new Notice(
                "IMA 内容无法粘贴到标题"
            );
        }
    }

    async pasteHtmlData(htmlData, editor, selection) {
        try {
            this.imageFailureCount = 0;
            this.tableCount = 0;

            if (this.htmlDataContainsImages(htmlData)) {
                new Notice(
                    "正在处理富文本图片，请稍候……"
                );
            }

            const documentNode =
                this.createSafeHtmlDocument(htmlData);

            const output =
                await this.convertHtmlDocumentToOutput(
                    documentNode
                );

            if (!output || !output.trim()) {
                throw new Error(
                    "HTML 内容为空或不包含可转换内容"
                );
            }

            editor.replaceRange(
                output,
                selection.from,
                selection.to
            );

            this.showPasteResultNotice();
        } catch (error) {
            console.error(
                "Rich HTML paste parsing failed:",
                error
            );

            new Notice(
                "HTML 富文本解析失败，未插入内容"
            );
        }
    }

    showPasteResultNotice() {
        if (this.imageFailureCount > 0) {
            new Notice(
                "内容已粘贴；" +
                this.imageFailureCount +
                " 张图片处理失败，已保留临时网络链接"
            );

            return;
        }

        if (
            this.tableCount > 0 &&
            this.settings.showTableNotice
        ) {
            new Notice(
                "内容已粘贴；表格已尽量保留。" +
                "HTML 表格不能像原生 Markdown 表格一样直接交互编辑"
            );

            return;
        }

        new Notice("内容已粘贴");
    }

    imaDataContainsImages(nodes) {
        if (!Array.isArray(nodes)) {
            return false;
        }

        for (const node of nodes) {
            if (!node || typeof node !== "object") {
                continue;
            }

            if (
                node.type === "cloud_image" ||
                node.type === "image"
            ) {
                return true;
            }

            if (
                Array.isArray(node.children) &&
                this.imaDataContainsImages(node.children)
            ) {
                return true;
            }
        }

        return false;
    }

    htmlDataContainsImages(htmlData) {
        return /<img\b/i.test(
            String(htmlData || "")
        );
    }

    convertImaToTitleText(nodes) {
        if (!Array.isArray(nodes)) {
            return "";
        }

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
        if (
            !navigator.clipboard ||
            typeof navigator.clipboard.read !== "function"
        ) {
            new Notice(
                "当前环境不支持读取剪贴板"
            );

            return;
        }

        navigator.clipboard
            .read()
            .then(async (clipboardItems) => {
                let encodedData = "";

                for (const item of clipboardItems) {
                    if (
                        !item.types.includes(
                            IMA_MIME_TYPE
                        )
                    ) {
                        continue;
                    }

                    const blob = await item.getType(
                        IMA_MIME_TYPE
                    );

                    encodedData = await blob.text();
                    break;
                }

                if (!encodedData) {
                    new Notice(
                        "当前剪贴板中没有 IMA 内容"
                    );

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

                new Notice(
                    "读取 IMA 剪贴板失败"
                );
            });
    }

    decodeImaData(encodedData) {
        let decodedText = String(encodedData || "");

        try {
            decodedText = this.decodeBase64Utf8(
                decodedText
            );
        } catch (error) {
            decodedText = String(encodedData || "");
        }

        try {
            decodedText = decodeURIComponent(
                decodedText
            );
        } catch (error) {
            console.warn(
                "IMA 数据 URL 解码失败，继续解析当前内容:",
                error
            );
        }

        const data = JSON.parse(decodedText);

        if (!Array.isArray(data)) {
            throw new Error(
                "IMA 数据不是节点数组"
            );
        }

        return data;
    }

    decodeBase64Utf8(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(
            binary.length
        );

        for (
            let index = 0;
            index < binary.length;
            index++
        ) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new TextDecoder(
            "utf-8"
        ).decode(bytes);
    }

    async convertImaToOutput(nodes) {
        const blocks = [];

        for (const node of nodes) {
            const block = await this.renderImaBlock(node);

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

    async renderImaBlock(node) {
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

        if (type === "image") {
            return this.renderCloudImage(node);
        }

        if (type === "cursor-side") {
            return this.renderImaChildren(children);
        }

        if (type === "table") {
            return this.renderImaTable(node);
        }

        if (type === "hr") {
            return "---";
        }

        if (type === "code_block") {
            return this.renderImaCodeBlock(node);
        }

        if (type === "action_item") {
            return this.renderImaActionItem(node);
        }

        if (type === "inline_equation") {
            return "";
        }

        if (
            type === "tr" ||
            type === "td"
        ) {
            return this.renderImaChildren(children);
        }

        const content =
            await this.renderImaChildren(children);

        if (
            !content &&
            children.length === 0 &&
            typeof node.text !== "string"
        ) {
            return "";
        }

        if (/^h[1-6]$/.test(type)) {
            const level = Number(
                type.charAt(1)
            );

            return (
                "#".repeat(level) +
                " " +
                this.removeLeadingHeadingMarks(
                    content
                )
            );
        }

        if (type === "blockquote") {
            return content
                .split("\n")
                .map((line) => "> " + line)
                .join("\n");
        }

        if (node.listStyleType === "disc") {
            return this.renderImaListItem(
                node,
                "-",
                content
            );
        }

        if (
            node.listStyleType === "decimal"
        ) {
            const number = Number.isFinite(
                node.listStart
            )
                ? node.listStart
                : 1;

            return this.renderImaListItem(
                node,
                number + ".",
                content
            );
        }

        return this.applyImaBlockAlignment(
            content,
            node.align
        );
    }

    async renderImaChildren(
        children,
        forceHtmlInlineStyles = false
    ) {
        let content = "";

        for (const child of children) {
            content += await this.renderImaInline(
                child,
                forceHtmlInlineStyles
            );
        }

        return content;
    }

    async renderImaInline(
        node,
        forceHtmlInlineStyles = false
    ) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (
            node.type === "cloud_image" ||
            node.type === "image"
        ) {
            return this.renderCloudImage(node);
        }

        if (node.type === "inline_equation") {
            return "";
        }

        if (node.type === "code_line") {
            return this.renderImaChildren(
                Array.isArray(node.children)
                    ? node.children
                    : [],
                forceHtmlInlineStyles
            );
        }

        const format = this.getPasteFormat();

        const nodeNeedsHtml =
            format === FORMAT_MARKDOWN_PRIORITY &&
            this.imaNodeHasComplexInlineStyle(node);

        const childNeedsHtml =
            forceHtmlInlineStyles ||
            nodeNeedsHtml;

        if (node.type === "a") {
            const children = Array.isArray(node.children)
                ? node.children
                : [];

            const label = await this.renderImaChildren(
                children,
                childNeedsHtml
            );

            const url = typeof node.url === "string"
                ? node.url
                : "";

            if (!url) {
                return this.applyImaInlineStyles(
                    label,
                    node,
                    forceHtmlInlineStyles
                );
            }

            return this.renderImaLink(
                label,
                url,
                node,
                forceHtmlInlineStyles
            );
        }

        let content = "";

        if (Array.isArray(node.children)) {
            content = await this.renderImaChildren(
                node.children,
                childNeedsHtml
            );
        } else if (typeof node.text === "string") {
            content = this.normalizeImaTextLineBreaks(
                node.text
            );
        }

        return this.applyImaInlineStyles(
            content,
            node,
            forceHtmlInlineStyles
        );
    }

    normalizeImaTextLineBreaks(text) {
        const normalized = String(text)
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

        if (this.getPasteFormat() === FORMAT_HTML) {
            return normalized.replace(
                /\n/g,
                "<br>"
            );
        }

        return normalized.replace(
            /\n/g,
            "  \n"
        );
    }

    removeLeadingHeadingMarks(text) {
        return String(text).replace(
            /^[#\s]+/,
            ""
        );
    }

    applyImaInlineStyles(
        content,
        node,
        forceHtmlInlineStyles = false
    ) {
        if (!content) {
            return "";
        }

        const format = this.getPasteFormat();

        const hasColor = Boolean(
            this.getUsableColor(node.color)
        );

        const hasBackground = Boolean(
            this.getUsableColor(node.backgroundColor)
        );

        const hasComplexStyle =
            hasColor ||
            hasBackground ||
            Boolean(node.underline);

        const useHtmlStyles =
            format === FORMAT_HTML ||
            forceHtmlInlineStyles ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                hasComplexStyle
            );

        if (useHtmlStyles) {
            return this.applyImaHtmlStyles(
                content,
                node
            );
        }

        let result = content;

        if (node.bold) {
            result = this.wrapStrong(result);
        }

        if (node.italic) {
            result = this.wrapEmphasis(result);
        }

        if (node.underline) {
            result = "<u>" + result + "</u>";
        }

        if (node.strikethrough) {
            result = this.wrapStrikethrough(result);
        }

        return result;
    }

    applyImaHtmlStyles(content, node) {
        let result = content;

        if (node.bold) {
            result =
                "<strong>" +
                result +
                "</strong>";
        }

        if (node.italic) {
            result =
                "<em>" +
                result +
                "</em>";
        }

        if (node.underline) {
            result =
                "<u>" +
                result +
                "</u>";
        }

        if (node.strikethrough) {
            result =
                "<s>" +
                result +
                "</s>";
        }

        const backgroundColor = this.getUsableColor(
            node.backgroundColor,
            true
        );

        if (backgroundColor) {
            result =
                "<mark " +
                this.createRichPasteAttribute() +
                " style=\"background-color:" +
                this.escapeHtmlAttribute(
                    backgroundColor
                ) +
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
                "<span " +
                this.createRichPasteAttribute() +
                " style=\"color:" +
                this.escapeHtmlAttribute(color) +
                ";\">" +
                result +
                "</span>";
        }

        return result;
    }

    applyImaBlockAlignment(content, align) {
        if (!content) {
            return "";
        }

        const alignments = {
            left: "left",
            center: "center",
            right: "right",
            justify: "justify"
        };

        const alignment = alignments[align];

        if (!alignment || alignment === "left") {
            return content;
        }

        const format = this.getPasteFormat();

        if (format === FORMAT_MARKDOWN) {
            return content;
        }

        return (
            "<div " +
            this.createRichPasteAttribute() +
            " style=\"text-align:" +
            alignment +
            ";\">" +
            content +
            "</div>"
        );
    }

    renderImaListItem(node, marker, content) {
        const indent = Number.isFinite(node.indent)
            ? "    ".repeat(
                Math.max(0, node.indent - 1)
            )
            : "";

        return (
            indent +
            marker +
            " " +
            content
        );
    }

    async renderImaCodeBlock(node) {
        const codeLines = this.findNodesByType(
            node.children || [],
            "code_line"
        );

        let code = "";

        if (codeLines.length > 0) {
            const lines = [];

            for (const line of codeLines) {
                lines.push(
                    this.extractPlainText(line)
                );
            }

            code = lines.join("\n");
        } else {
            code = this.extractPlainText(node);
        }

        const fence = this.getCodeFence(code);

        return (
            fence +
            "\n" +
            code +
            "\n" +
            fence
        );
    }

    getCodeFence(code) {
        const matches =
            String(code).match(/`+/g) || [];

        let longest = 0;

        for (const match of matches) {
            longest = Math.max(
                longest,
                match.length
            );
        }

        return "`".repeat(
            Math.max(3, longest + 1)
        );
    }

    async renderImaActionItem(node) {
        const content =
            await this.renderImaChildren(
                Array.isArray(node.children)
                    ? node.children
                    : []
            );

        const indent = Number.isFinite(node.indent)
            ? "    ".repeat(
                Math.max(0, node.indent - 1)
            )
            : "";

        const checked = node.checked
            ? "x"
            : " ";

        return (
            indent +
            "- [" +
            checked +
            "] " +
            content
        );
    }

    async renderImaTable(tableNode) {
        this.tableCount =
            (this.tableCount || 0) + 1;

        const rows = this.findNodesByType(
            tableNode.children || [],
            "tr"
        );

        if (rows.length === 0) {
            return "";
        }

        const format = this.getPasteFormat();
        const complex =
            this.tableHasComplexContent(rows);

        if (
            format === FORMAT_HTML ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                complex
            )
        ) {
            return this.renderImaHtmlTable(
                tableNode,
                rows
            );
        }

        return this.renderImaMarkdownTable(rows);
    }

    tableHasComplexContent(rows) {
        for (const row of rows) {
            const cells = Array.isArray(row.children)
                ? row.children.filter((child) => {
                    return child &&
                        child.type === "td";
                })
                : [];

            for (const cell of cells) {
                if (
                    this.nodeHasComplexTableStyle(
                        cell
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    nodeHasComplexTableStyle(node) {
        if (!node || typeof node !== "object") {
            return false;
        }

        if (
            node.color ||
            node.backgroundColor ||
            node.underline ||
            node.colspan ||
            node.rowspan
        ) {
            return true;
        }

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                if (
                    this.nodeHasComplexTableStyle(
                        child
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    async renderImaHtmlTable(tableNode, rows) {
        const columns = [];
        const colSizes =
            this.getTableColumnSizes(tableNode);

        for (const width of colSizes) {
            const size = Number(width);

            if (
                !Number.isFinite(size) ||
                size <= 0
            ) {
                columns.push("<col>");
                continue;
            }

            columns.push(
                "<col style=\"width:" +
                size +
                "px;\">"
            );
        }

        const renderedRows = [];

        for (const row of rows) {
            const cells = Array.isArray(row.children)
                ? row.children.filter((child) => {
                    return child &&
                        child.type === "td";
                })
                : [];

            const renderedCells = [];

            for (const cell of cells) {
                const cellContent =
                    await this.renderImaTableCell(
                        cell
                    );

                let attributes = "";

                const colspan = Number(
                    cell.colspan
                );

                const rowspan = Number(
                    cell.rowspan
                );

                if (
                    Number.isFinite(colspan) &&
                    colspan > 1
                ) {
                    attributes +=
                        " colspan=\"" +
                        Math.floor(colspan) +
                        "\"";
                }

                if (
                    Number.isFinite(rowspan) &&
                    rowspan > 1
                ) {
                    attributes +=
                        " rowspan=\"" +
                        Math.floor(rowspan) +
                        "\"";
                }

                renderedCells.push(
                    "<td" +
                    attributes +
                    ">" +
                    (cellContent || "&nbsp;") +
                    "</td>"
                );
            }

            let rowStyle = "";

            const rowHeight = Number(
                row.size ||
                row.height ||
                row.rowHeight
            );

            if (
                Number.isFinite(rowHeight) &&
                rowHeight > 0
            ) {
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

        const parts = [
            "<table " +
            this.createRichPasteAttribute() +
            ">"
        ];

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

    async renderImaTableCell(cellNode) {
        const children = Array.isArray(
            cellNode.children
        )
            ? cellNode.children
            : [];

        const parts = [];

        for (const child of children) {
            const content =
                await this.renderImaTableInline(
                    child
                );

            if (content) {
                parts.push(content);
            }
        }

        if (parts.length === 0) {
            return "&nbsp;";
        }

        return parts.join("<br>");
    }

    async renderImaTableInline(node) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (
            node.type === "cloud_image" ||
            node.type === "image"
        ) {
            return this.renderCloudImage(node);
        }

        if (node.type === "inline_equation") {
            return "";
        }

        if (node.type === "a") {
            const children = Array.isArray(
                node.children
            )
                ? node.children
                : [];

            const label =
                await this.renderImaTableChildren(
                    children
                );

            const url = typeof node.url === "string"
                ? node.url
                : "";

            if (!url) {
                return this.applyImaTableInlineStyles(
                    label,
                    node
                );
            }

            const link = this.renderImaLink(
                label,
                url,
                node
            );

            return this.applyImaTableInlineStyles(
                link,
                node
            );
        }

        if (Array.isArray(node.children)) {
            const content =
                await this.renderImaTableChildren(
                    node.children
                );

            return this.applyImaTableInlineStyles(
                content,
                node
            );
        }

        if (typeof node.text !== "string") {
            return "";
        }

        const text = this.escapeHtml(node.text)
            .replace(/\r\n/g, "<br>")
            .replace(/\r/g, "<br>")
            .replace(/\n/g, "<br>");

        return this.applyImaTableInlineStyles(
            text,
            node
        );
    }

    async renderImaTableChildren(children) {
        let content = "";

        for (const child of children) {
            content +=
                await this.renderImaTableInline(
                    child
                );
        }

        return content;
    }

    applyImaTableInlineStyles(content, node) {
        if (!content) {
            return "";
        }

        const format = this.getPasteFormat();
        const hasComplexStyle =
            this.nodeHasComplexTableStyle(node);

        if (
            format === FORMAT_HTML ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                hasComplexStyle
            )
        ) {
            return this.applyImaHtmlStyles(
                content,
                node
            );
        }

        let result = content;

        if (node.bold) {
            result = this.wrapStrong(result);
        }

        if (node.italic) {
            result = this.wrapEmphasis(result);
        }

        if (node.underline) {
            result = "<u>" + result + "</u>";
        }

        if (node.strikethrough) {
            result = this.wrapStrikethrough(result);
        }

        return result;
    }

    async renderImaMarkdownTable(rows) {
        const matrix = [];
        let maxColumns = 0;

        for (const row of rows) {
            const cells = Array.isArray(row.children)
                ? row.children.filter((child) => {
                    return child &&
                        child.type === "td";
                })
                : [];

            const values = [];

            for (const cell of cells) {
                const text = this.extractPlainText(cell)
                    .replace(/\r\n/g, " ")
                    .replace(/\r/g, " ")
                    .replace(/\n/g, " ")
                    .replace(/\|/g, "\\|")
                    .trim();

                values.push(text);
            }

            maxColumns = Math.max(
                maxColumns,
                values.length
            );

            matrix.push(values);
        }

        if (maxColumns === 0) {
            return "";
        }

        for (const row of matrix) {
            while (row.length < maxColumns) {
                row.push("");
            }
        }

        const lines = [];
        const header = matrix[0] ||
            new Array(maxColumns).fill("");

        lines.push(
            "| " +
            header.join(" | ") +
            " |"
        );

        lines.push(
            "| " +
            new Array(maxColumns)
                .fill("---")
                .join(" | ") +
            " |"
        );

        for (
            let index = 1;
            index < matrix.length;
            index++
        ) {
            lines.push(
                "| " +
                matrix[index].join(" | ") +
                " |"
            );
        }

        return lines.join("\n");
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
                    ...this.findNodesByType(
                        node.children,
                        type
                    )
                );
            }
        }

        return found;
    }

    createSafeHtmlDocument(htmlData) {
        const parser = new DOMParser();
        const documentNode = parser.parseFromString(
            String(htmlData || ""),
            "text/html"
        );

        this.removeUnsafeHtmlNodes(documentNode);
        this.removeUnsafeHtmlAttributes(documentNode);

        return documentNode;
    }

    removeUnsafeHtmlNodes(documentNode) {
        const selectors = [
            "script",
            "style",
            "iframe",
            "frame",
            "frameset",
            "object",
            "embed",
            "video",
            "audio",
            "source",
            "form",
            "input",
            "button",
            "select",
            "textarea",
            "svg",
            "math",
            "meta",
            "link"
        ].join(", ");

        for (const element of Array.from(
            documentNode.querySelectorAll(selectors)
        )) {
            element.remove();
        }
    }

    removeUnsafeHtmlAttributes(documentNode) {
        for (const element of Array.from(
            documentNode.querySelectorAll("*")
        )) {
            for (const attribute of Array.from(
                element.attributes
            )) {
                const name = attribute.name.toLowerCase();
                const value = attribute.value.trim();

                if (name.startsWith("on")) {
                    element.removeAttribute(attribute.name);
                    continue;
                }

                if (
                    name === "srcdoc" ||
                    name === "formaction"
                ) {
                    element.removeAttribute(attribute.name);
                    continue;
                }

                if (
                    (name === "href" || name === "src") &&
                    /^javascript:/i.test(value)
                ) {
                    element.removeAttribute(attribute.name);
                }
            }
        }
    }

    async convertHtmlDocumentToOutput(documentNode) {
        const blocks = [];

        for (const child of Array.from(
            documentNode.body.childNodes
        )) {
            const block = await this.renderHtmlBlock(child);

            if (block !== null && block !== "") {
                blocks.push(block);
            }
        }

        return blocks.join("\n\n").trim();
    }

    async renderHtmlBlock(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = this.normalizeHtmlText(
                node.textContent
            );

            return text.trim() ? text : "";
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const element = node;
        const tagName = element.tagName.toLowerCase();

        if (tagName === "br") {
            return "";
        }

        if (tagName === "hr") {
            return "---";
        }

        if (tagName === "img") {
            return this.renderHtmlImage(element);
        }

        if (tagName === "table") {
            return this.renderHtmlTable(element);
        }

        if (tagName === "pre") {
            return this.renderHtmlPreformatted(element);
        }

        if (tagName === "blockquote") {
            const content = await this.renderHtmlChildren(
                element
            );

            if (!content) {
                return "";
            }

            return content
                .split("\n")
                .map((line) => "> " + line)
                .join("\n");
        }

        if (tagName === "ul") {
            return this.renderHtmlList(element, false);
        }

        if (tagName === "ol") {
            return this.renderHtmlList(element, true);
        }

        if (/^h[1-6]$/.test(tagName)) {
            const level = Number(tagName.charAt(1));
            const content = await this.renderHtmlChildren(
                element
            );

            return (
                "#".repeat(level) +
                " " +
                this.removeLeadingHeadingMarks(content)
            );
        }

        const content = await this.renderHtmlChildren(element);

        if (!content) {
            return "";
        }

        if (
            tagName === "p" ||
            tagName === "div" ||
            tagName === "section" ||
            tagName === "article" ||
            tagName === "main" ||
            tagName === "header" ||
            tagName === "footer"
        ) {
            return this.applyHtmlElementAlignment(
                content,
                element
            );
        }

        return this.applyHtmlElementStyles(
            content,
            element
        );
    }

    async renderHtmlChildren(
        element,
        forceHtmlInlineStyles = false
    ) {
        let content = "";

        for (const child of Array.from(
            element.childNodes
        )) {
            content += await this.renderHtmlInline(
                child,
                forceHtmlInlineStyles
            );
        }

        return content;
    }

    async renderHtmlInline(
        node,
        forceHtmlInlineStyles = false
    ) {
        if (node.nodeType === Node.TEXT_NODE) {
            return this.normalizeHtmlText(node.textContent);
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return "";
        }

        const element = node;
        const tagName = element.tagName.toLowerCase();
        const format = this.getPasteFormat();

        if (tagName === "br") {
            return format === FORMAT_HTML
                ? "<br>"
                : "  \n";
        }

        if (tagName === "img") {
            return this.renderHtmlImage(element);
        }

        if (tagName === "code") {
            const text = element.textContent || "";

            return "`" + text.replace(/`/g, "\\`") + "`";
        }

        if (tagName === "pre") {
            return this.renderHtmlPreformatted(element);
        }

        const elementNeedsHtml =
            format === FORMAT_MARKDOWN_PRIORITY &&
            this.htmlElementNeedsHtmlWrapper(element);

        const childNeedsHtml =
            forceHtmlInlineStyles ||
            elementNeedsHtml;

        const content = await this.renderHtmlChildren(
            element,
            childNeedsHtml
        );

        if (!content) {
            return "";
        }

        if (tagName === "a") {
            const url = this.getSafeLinkUrl(
                element.getAttribute("href")
            );

            if (!url) {
                return this.applyHtmlElementStyles(
                    content,
                    element,
                    forceHtmlInlineStyles
                );
            }

            return this.renderHtmlLink(
                content,
                url,
                element,
                forceHtmlInlineStyles
            );
        }

        return this.applyHtmlElementStyles(
            content,
            element,
            forceHtmlInlineStyles
        );
    }

    normalizeHtmlText(text) {
        return String(text || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/\u00a0/g, " ");
    }

    getSafeLinkUrl(url) {
        const value = String(url || "").trim();

        if (!value || /^javascript:/i.test(value)) {
            return "";
        }

        return value;
    }

    renderImaLink(
        label,
        url,
        node,
        forceHtmlInlineStyles = false
    ) {
        const format = this.getPasteFormat();

        const useHtmlLink =
            format === FORMAT_HTML ||
            forceHtmlInlineStyles ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                this.imaNodeHasComplexInlineStyle(node)
            );

        if (useHtmlLink) {
            const link =
                "<a " +
                this.createRichPasteAttribute() +
                " href=\"" +
                this.escapeHtmlAttribute(url) +
                "\">" +
                label +
                "</a>";

            return this.applyImaInlineStyles(
                link,
                node,
                true
            );
        }

        const link =
            "[" +
            label +
            "](" +
            this.escapeLinkUrl(url) +
            ")";

        return this.applyImaInlineStyles(
            link,
            node,
            false
        );
    }

    renderHtmlLink(
        label,
        url,
        element,
        forceHtmlInlineStyles = false
    ) {
        const format = this.getPasteFormat();

        const useHtmlLink =
            format === FORMAT_HTML ||
            forceHtmlInlineStyles ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                this.htmlElementNeedsHtmlWrapper(element)
            );

        if (useHtmlLink) {
            const link =
                "<a " +
                this.createRichPasteAttribute() +
                " href=\"" +
                this.escapeHtmlAttribute(url) +
                "\">" +
                label +
                "</a>";

            return this.applyHtmlElementStyles(
                link,
                element,
                true
            );
        }

        const link =
            "[" +
            label +
            "](" +
            this.escapeLinkUrl(url) +
            ")";

        return this.applyHtmlElementStyles(
            link,
            element,
            false
        );
    }

    imaNodeHasComplexInlineStyle(node) {
        return Boolean(
            this.getUsableColor(node.color, false) ||
            this.getUsableColor(
                node.backgroundColor,
                true
            ) ||
            node.underline
        );
    }

    htmlElementHasComplexInlineStyle(element) {
        const style = element.style;

        return Boolean(
            this.getElementTextColor(element) ||
            this.getUsableColor(
                style.backgroundColor,
                true
            ) ||
            style.textDecoration.includes("underline") ||
            element.tagName.toLowerCase() === "u"
        );
    }

    getElementTextColor(element) {
        const styleColor = element.style.color;

        if (styleColor) {
            return this.getUsableColor(styleColor, false);
        }

        const fontColor = element.getAttribute("color");

        return this.getUsableColor(fontColor, false);
    }

        htmlElementNeedsHtmlWrapper(element) {
        if (!(element instanceof Element)) {
            return false;
        }

        const style = element.style;
        const alignment = this.getElementTextAlignment(
            element
        );

        return Boolean(
            this.getElementTextColor(element) ||
            this.getUsableColor(
                style.backgroundColor
            ) ||
            element.tagName.toLowerCase() === "u" ||
            style.textDecoration.includes("underline") ||
            (
                alignment &&
                alignment !== "left"
            )
        );
    }

    applyHtmlElementStyles(
        content,
        element,
        forceHtmlInlineStyles = false
    ) {
        if (!content) {
            return "";
        }

        const tagName = element.tagName.toLowerCase();
        const style = element.style;
        const format = this.getPasteFormat();

        const color = this.getElementTextColor(element);

        const backgroundColor = this.getUsableColor(
            style.backgroundColor
        );

        const bold =
            tagName === "strong" ||
            tagName === "b" ||
            style.fontWeight === "bold" ||
            Number(style.fontWeight) >= 600;

        const italic =
            tagName === "em" ||
            tagName === "i" ||
            style.fontStyle === "italic";

        const underline =
            tagName === "u" ||
            style.textDecoration.includes("underline");

        const strikethrough =
            tagName === "s" ||
            tagName === "del" ||
            tagName === "strike" ||
            style.textDecoration.includes("line-through");

        const hasComplexStyle =
            Boolean(color) ||
            Boolean(backgroundColor) ||
            underline;

        const useHtmlStyles =
            format === FORMAT_HTML ||
            forceHtmlInlineStyles ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                hasComplexStyle
            );

        if (!useHtmlStyles) {
            let result = content;

            if (bold) {
                result = this.wrapStrong(result);
            }

            if (italic) {
                result = this.wrapEmphasis(result);
            }

            if (underline) {
                result = "<u>" + result + "</u>";
            }

            if (strikethrough) {
                result = this.wrapStrikethrough(result);
            }

            return result;
        }

        let result = content;

        if (bold) {
            result = "<strong>" + result + "</strong>";
        }

        if (italic) {
            result = "<em>" + result + "</em>";
        }

        if (underline) {
            result = "<u>" + result + "</u>";
        }

        if (strikethrough) {
            result = "<s>" + result + "</s>";
        }

        if (backgroundColor) {
            result =
                "<mark " +
                this.createRichPasteAttribute() +
                " style=\"background-color:" +
                this.escapeHtmlAttribute(
                    backgroundColor
                ) +
                ";\">" +
                result +
                "</mark>";
        }

        if (color) {
            result =
                "<span " +
                this.createRichPasteAttribute() +
                " style=\"color:" +
                this.escapeHtmlAttribute(color) +
                ";\">" +
                result +
                "</span>";
        }

        return result;
    }

    applyHtmlElementAlignment(content, element) {
        const alignment = this.getElementTextAlignment(
            element
        );

        if (!alignment || alignment === "left") {
            return content;
        }

        if (this.getPasteFormat() === FORMAT_MARKDOWN) {
            return content;
        }

        return (
            "<div " +
            this.createRichPasteAttribute() +
            " style=\"text-align:" +
            alignment +
            ";\">" +
            content +
            "</div>"
        );
    }

    getElementTextAlignment(element) {
        const styleAlignment = String(
            element.style.textAlign || ""
        ).trim().toLowerCase();

        if (
            [
                "left",
                "center",
                "right",
                "justify"
            ].includes(styleAlignment)
        ) {
            return styleAlignment;
        }

        const attributeAlignment = String(
            element.getAttribute("align") || ""
        ).trim().toLowerCase();

        if (
            [
                "left",
                "center",
                "right",
                "justify"
            ].includes(attributeAlignment)
        ) {
            return attributeAlignment;
        }

        return "";
    }

    async renderHtmlList(element, ordered) {
        const items = [];

        for (const child of Array.from(element.children)) {
            if (child.tagName.toLowerCase() !== "li") {
                continue;
            }

            const content = await this.renderHtmlChildren(
                child
            );

            if (content) {
                items.push(content);
            }
        }

        const start = ordered
            ? Math.max(
                1,
                Number(element.getAttribute("start")) || 1
            )
            : 1;

        return items
            .map((content, index) => {
                const marker = ordered
                    ? start + index + "."
                    : "-";

                return marker + " " + content;
            })
            .join("\n");
    }

    async renderHtmlPreformatted(element) {
        const codeElement = element.querySelector("code");
        const code = codeElement
            ? codeElement.textContent || ""
            : element.textContent || "";

        const fence = this.getCodeFence(code);

        return (
            fence +
            "\n" +
            code +
            "\n" +
            fence
        );
    }

    async renderHtmlImage(element) {
        const url = String(
            element.getAttribute("src") || ""
        ).trim();

        const alt = String(
            element.getAttribute("alt") || "图片"
        ).trim();

        if (!url || /^javascript:/i.test(url)) {
            return "";
        }

        if (url.startsWith("data:")) {
            this.imageFailureCount += 1;

            return (
                "> [!warning] 富文本图片使用了无法保存的内嵌数据"
            );
        }

        try {
            const imagePath = await this.downloadImage(url);

            return this.createVaultImageEmbed(
                imagePath,
                alt
            );
        } catch (error) {
            console.error(
                "HTML image download failed:",
                error
            );

            this.imageFailureCount += 1;

            return (
                "![" +
                this.escapeMarkdownAlt(alt) +
                "](" +
                this.escapeLinkUrl(url) +
                ")"
            );
        }
    }

    async renderCloudImage(node) {
        const url = typeof node.url === "string"
            ? node.url.trim()
            : "";

        if (!url) {
            this.imageFailureCount += 1;

            return "> [!warning] IMA 图片没有可用地址";
        }

        try {
            const imagePath = await this.downloadImage(url);

            return this.createVaultImageEmbed(
                imagePath,
                "IMA 图片"
            );
        } catch (error) {
            console.error(
                "IMA image download failed:",
                error
            );

            this.imageFailureCount += 1;

            return (
                "![" +
                this.escapeMarkdownAlt(
                    "IMA 图片（下载失败）"
                ) +
                "](" +
                this.escapeLinkUrl(url) +
                ")"
            );
        }
    }

    async renderHtmlTable(tableElement) {
        this.tableCount =
            (this.tableCount || 0) + 1;

        const rows = Array.from(
            tableElement.querySelectorAll("tr")
        );

        if (rows.length === 0) {
            return "";
        }

        const format = this.getPasteFormat();
        const complex = this.htmlTableIsComplex(
            tableElement,
            rows
        );

        if (
            format === FORMAT_HTML ||
            (
                format === FORMAT_MARKDOWN_PRIORITY &&
                complex
            )
        ) {
            return this.renderHtmlTableAsHtml(rows);
        }

        return this.renderHtmlTableAsMarkdown(rows);
    }

    htmlTableIsComplex(tableElement, rows) {
        if (
            tableElement.querySelector(
                "img, table, [colspan], [rowspan]"
            )
        ) {
            return true;
        }

        if (
            tableElement.querySelector(
                "span[style], mark, u, font"
            )
        ) {
            return true;
        }

        for (const row of rows) {
            const cells = Array.from(
                row.querySelectorAll(":scope > th, :scope > td")
            );

            for (const cell of cells) {
                const style = cell.style;

                if (
                    this.getElementTextColor(cell) ||
                    this.getUsableColor(
                        style.backgroundColor,
                        true
                    ) ||
                    style.textDecoration.includes("underline")
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    async renderHtmlTableAsHtml(rows) {
        const renderedRows = [];

        for (const row of rows) {
            const cells = Array.from(
                row.querySelectorAll(":scope > th, :scope > td")
            );

            const renderedCells = [];

            for (const cell of cells) {
                const tagName = cell.tagName.toLowerCase();
                const content = await this.renderHtmlChildren(
                    cell
                );

                let attributes = "";

                const colspan = Number(
                    cell.getAttribute("colspan")
                );

                const rowspan = Number(
                    cell.getAttribute("rowspan")
                );

                if (
                    Number.isFinite(colspan) &&
                    colspan > 1
                ) {
                    attributes +=
                        " colspan=\"" +
                        Math.floor(colspan) +
                        "\"";
                }

                if (
                    Number.isFinite(rowspan) &&
                    rowspan > 1
                ) {
                    attributes +=
                        " rowspan=\"" +
                        Math.floor(rowspan) +
                        "\"";
                }

                renderedCells.push(
                    "<" +
                    tagName +
                    attributes +
                    ">" +
                    (content || "&nbsp;") +
                    "</" +
                    tagName +
                    ">"
                );
            }

            renderedRows.push(
                "<tr>" +
                renderedCells.join("") +
                "</tr>"
            );
        }

        return [
            "<table " +
            this.createRichPasteAttribute() +
            ">",
            "<tbody>",
            renderedRows.join("\n"),
            "</tbody>",
            "</table>"
        ].join("\n");
    }

    async renderHtmlTableAsMarkdown(rows) {
        const matrix = [];
        let maxColumns = 0;

        for (const row of rows) {
            const cells = Array.from(
                row.querySelectorAll(":scope > th, :scope > td")
            );

            const values = [];

            for (const cell of cells) {
                const text = String(
                    cell.textContent || ""
                )
                    .replace(/\r\n/g, " ")
                    .replace(/\r/g, " ")
                    .replace(/\n/g, " ")
                    .replace(/\|/g, "\\|")
                    .trim();

                values.push(text);
            }

            maxColumns = Math.max(
                maxColumns,
                values.length
            );

            matrix.push(values);
        }

        if (maxColumns === 0) {
            return "";
        }

        for (const row of matrix) {
            while (row.length < maxColumns) {
                row.push("");
            }
        }

        const lines = [];
        const header = matrix[0] ||
            new Array(maxColumns).fill("");

        lines.push(
            "| " +
            header.join(" | ") +
            " |"
        );

        lines.push(
            "| " +
            new Array(maxColumns)
                .fill("---")
                .join(" | ") +
            " |"
        );

        for (
            let index = 1;
            index < matrix.length;
            index++
        ) {
            lines.push(
                "| " +
                matrix[index].join(" | ") +
                " |"
            );
        }

        return lines.join("\n");
    }

    async downloadImage(url) {
        await this.ensureImageFolder();

        const extension = this.getImageExtension(url);
        const fileName = this.createImageFileName(
            url,
            extension
        );

        const imagePath =
            this.getImageFolder() +
            "/" +
            fileName;

        if (
            await this.app.vault.adapter.exists(
                imagePath
            )
        ) {
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
        const folder = this.getImageFolder();

        if (await adapter.exists(folder)) {
            return;
        }

        try {
            await this.app.vault.createFolder(folder);
        } catch (error) {
            if (!(await adapter.exists(folder))) {
                throw error;
            }
        }
    }

    createImageFileName(url, extension) {
        const stableUrl = this.getStableImageUrl(url);
        const hash = this.hashText(stableUrl);

        return (
            "rich-paste-image-" +
            hash +
            "." +
            extension
        );
    }

    getStableImageUrl(url) {
        try {
            const parsedUrl = new URL(url);

            return (
                parsedUrl.origin +
                parsedUrl.pathname
            );
        } catch (error) {
            return String(url).split("?")[0];
        }
    }

    hashText(text) {
        let hash = 2166136261;

        for (
            let index = 0;
            index < text.length;
            index++
        ) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0)
            .toString(16)
            .padStart(8, "0");
    }

    getImageExtension(url) {
        try {
            const pathname = new URL(url).pathname;
            const match = pathname.match(
                /\.([a-zA-Z0-9]{2,5})$/
            );

            if (match) {
                const extension = match[1].toLowerCase();

                if (
                    [
                        "jpg",
                        "jpeg",
                        "png",
                        "gif",
                        "webp",
                        "avif",
                        "svg"
                    ].includes(extension)
                ) {
                    return extension === "jpeg"
                        ? "jpg"
                        : extension;
                }
            }
        } catch (error) {
            console.warn(
                "Unable to determine image extension:",
                error
            );
        }

        return "png";
    }

    getUsableColor(color) {
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

        if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
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

        if (this.isHslColor(normalized)) {
            return normalized;
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
        const match = String(color).match(
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
        const repaired = this.repairRgbColor(color);

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
            !this.isValidRgbChannel(blue) ||
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
        const value = String(color || "").trim();

        const completePattern =
            /^(rgba?)\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*\)$/i;

        if (completePattern.test(value)) {
            return value;
        }

        const incompleteMatch = value.match(
            /^(rgba?)\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*$/i
        );

        if (!incompleteMatch) {
            return "";
        }

        return (
            incompleteMatch[1] +
            "(" +
            incompleteMatch[2] +
            ", " +
            incompleteMatch[3] +
            ", " +
            incompleteMatch[4] +
            (
                incompleteMatch[5] === undefined
                    ? ""
                    : ", " + incompleteMatch[5]
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

    isHslColor(color) {
        return /^hsla?\(\s*[-+]?(?:\d+(?:\.\d+)?)\s*(?:deg|grad|rad|turn)?\s*,\s*\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(
            String(color || "").trim()
        );
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

    createVaultImageEmbed(imagePath, alt) {
        const path = String(imagePath || "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "");

        if (!path) {
            return "";
        }

        const label = String(alt || "")
            .replace(/\|/g, "/")
            .replace(/\]/g, ")")
            .trim();

        if (!label) {
            return "![["
                + path
                + "]]";
        }

        return "![["
            + path
            + "|"
            + label
            + "]]";
    }

    async repairAllNoteImageLinks() {
        const markdownFiles =
            this.app.vault.getMarkdownFiles();

        const repairs = [];
        let repairedCount = 0;
        let unresolvedCount = 0;

        for (const file of markdownFiles) {
            const originalContent =
                await this.app.vault.read(file);

            const imagePattern =
                /!\[([^\]]*)\]\(\s*(app:\/\/[^)\s]+)\s*\)/g;

            const matches = Array.from(
                originalContent.matchAll(imagePattern)
            );

            if (matches.length === 0) {
                continue;
            }

            let repairedContent = originalContent;
            let fileRepairCount = 0;

            for (const match of matches) {
                const fullMatch = match[0];
                const alt = match[1] || "";
                const oldUrl = match[2] || "";

                const imageFile =
                    await this.findLegacyImageFile(
                        oldUrl
                    );

                if (!imageFile) {
                    unresolvedCount += 1;
                    continue;
                }

                const newEmbed =
                    this.createVaultImageEmbed(
                        imageFile.path,
                        alt || "IMA 图片"
                    );

                repairedContent =
                    repairedContent.replace(
                        fullMatch,
                        newEmbed
                    );

                repairedCount += 1;
                fileRepairCount += 1;
            }

            if (
                fileRepairCount > 0 &&
                repairedContent !== originalContent
            ) {
                repairs.push({
                    file: file,
                    content: repairedContent,
                    count: fileRepairCount
                });
            }
        }

        if (repairs.length === 0) {
            if (unresolvedCount > 0) {
                new Notice(
                    "没有找到可自动修复的图片；" +
                    unresolvedCount +
                    " 个旧图片地址无法找到唯一对应文件"
                );
            } else {
                new Notice(
                    "所有笔记中没有找到可修复的旧图片地址"
                );
            }

            return;
        }

        new GlobalImageRepairModal(
            this.app,
            repairs.length,
            repairedCount,
            unresolvedCount,
            async () => {
                for (const repair of repairs) {
                    await this.app.vault.modify(
                        repair.file,
                        repair.content
                    );
                }

                if (unresolvedCount > 0) {
                    new Notice(
                        "已修复 " +
                        repairedCount +
                        " 个图片地址；" +
                        unresolvedCount +
                        " 个地址未修改"
                    );
                } else {
                    new Notice(
                        "已修复 " +
                        repairedCount +
                        " 个图片地址"
                    );
                }
            }
        ).open();
    }

    async findLegacyImageFile(oldUrl) {
        let decodedUrl = String(oldUrl || "");

        try {
            decodedUrl = decodeURIComponent(
                decodedUrl
            );
        } catch (error) {
            decodedUrl = String(oldUrl || "");
        }

        const pathWithoutQuery =
            decodedUrl.split(/[?#]/)[0];

        const fileNameMatch =
            pathWithoutQuery.match(
                /\/((?:rich-paste-image|ima-image)-[^/]+\.(?:png|jpe?g|gif|webp|avif|svg))$/i
            );

        if (!fileNameMatch) {
            return null;
        }

        const fileName =
            fileNameMatch[1].toLowerCase();

        const imageFiles = this.app.vault
            .getFiles()
            .filter((file) => {
                const extension =
                    file.extension.toLowerCase();

                return [
                    "png",
                    "jpg",
                    "jpeg",
                    "gif",
                    "webp",
                    "avif",
                    "svg"
                ].includes(extension);
            })
            .filter((file) => {
                return file.name.toLowerCase() === fileName;
            });

        if (imageFiles.length === 0) {
            return null;
        }

        const imageFolder =
            this.getImageFolder()
                .replace(/\\/g, "/")
                .replace(/^\/+|\/+$/g, "");

        const preferredPath =
            imageFolder + "/" + fileName;

        const preferredFile = imageFiles.find((file) => {
            return file.path.toLowerCase() ===
                preferredPath.toLowerCase();
        });

        if (preferredFile) {
            return preferredFile;
        }

        if (imageFiles.length === 1) {
            return imageFiles[0];
        }

        return null;
    }

    async cleanUnusedPluginImages() {
        const imageFolder = this.getImageFolder()
            .replace(/\\/g, "/")
            .replace(/^\/+|\/+$/g, "");

        const imageExtensions = [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "avif",
            "svg"
        ];

        const imageFiles = this.app.vault
            .getFiles()
            .filter((file) => {
                if (
                    !file.path.startsWith(
                        imageFolder + "/"
                    )
                ) {
                    return false;
                }

                if (
                    !imageExtensions.includes(
                        file.extension.toLowerCase()
                    )
                ) {
                    return false;
                }

                return /^(?:rich-paste-image|ima-image)-/i.test(
                    file.name
                );
            });

        if (imageFiles.length === 0) {
            new Notice(
                "当前图片保存目录中没有可检查的插件图片"
            );

            return;
        }

        const referencedPaths =
            await this.collectReferencedImagePaths();

        const unusedFiles = imageFiles.filter((file) => {
            return !referencedPaths.has(file.path);
        });

        if (unusedFiles.length === 0) {
            new Notice(
                "没有找到未被引用的插件图片"
            );

            return;
        }

        new UnusedPluginImageCleanupModal(
            this.app,
            unusedFiles,
            async () => {
                let deletedCount = 0;

                for (const file of unusedFiles) {
                    try {
                        await this.app.fileManager.trashFile(
                            file
                        );

                        deletedCount += 1;
                    } catch (error) {
                        console.error(
                            "清理未使用图片失败:",
                            file.path,
                            error
                        );
                    }
                }

                new Notice(
                    "已移入回收站 " +
                    deletedCount +
                    " 张未被引用的插件图片"
                );
            }
        ).open();
    }

    async collectReferencedImagePaths() {
        const referencedPaths = new Set();
        const markdownFiles =
            this.app.vault.getMarkdownFiles();

        for (const noteFile of markdownFiles) {
            const cache = this.app.metadataCache
                .getFileCache(noteFile);

            const embeds = cache && Array.isArray(cache.embeds)
                ? cache.embeds
                : [];

            for (const embed of embeds) {
                const target =
                    this.app.metadataCache
                        .getFirstLinkpathDest(
                            embed.link,
                            noteFile.path
                        );

                if (target) {
                    referencedPaths.add(target.path);
                }
            }

            const noteContent =
                await this.app.vault.read(noteFile);

            for (const imageFile of this.app.vault.getFiles()) {
                if (
                    !/^(?:rich-paste-image|ima-image)-/i.test(
                        imageFile.name
                    )
                ) {
                    continue;
                }

                const path = imageFile.path;
                const encodedPath = encodeURI(path);

                if (
                    noteContent.includes(path) ||
                    noteContent.includes(encodedPath)
                ) {
                    referencedPaths.add(path);
                }
            }
        }

        return referencedPaths;
    }
    async openCurrentNoteConversion(forcedFormat) {

        const view = this.getActiveMarkdownView();

        if (!view || !view.editor) {
            new Notice("请先打开一个 Markdown 笔记");
            return;
        }

        const initialFormat = this.getConversionFormat(
            forcedFormat
        );

        new RichPasteConversionModal(
            this.app,
            this,
            initialFormat,
            async (targetFormat) => {
                await this.convertCurrentNote(
                    targetFormat
                );
            }
        ).open();
    }

    async convertCurrentNote(targetFormat) {
        const view = this.getActiveMarkdownView();

        if (!view || !view.editor) {
            new Notice("请先打开一个 Markdown 笔记");
            return;
        }

        if (!this.isConversionFormat(targetFormat)) {
            new Notice("请选择 Markdown 转换格式");
            return;
        }

        const originalContent = view.editor.getValue();

        const preview =
            await this.createConversionPreview(
                originalContent,
                targetFormat
            );

        if (!preview.changed) {
            new Notice(
                "当前笔记中没有找到可转换的 HTML 内容"
            );

            return;
        }

        const applyConversion = () => {
            view.editor.setValue(preview.content);

            new Notice(
                targetFormat === FORMAT_MARKDOWN
                    ? "当前笔记已转换为 Markdown 兼容格式"
                    : "当前笔记已转换为 Markdown 优先格式"
            );
        };

        if (!this.settings.confirmBeforeConversion) {
            applyConversion();
            return;
        }

        new RichPasteConversionConfirmModal(
            this.app,
            targetFormat,
            preview.stats,
            applyConversion
        ).open();
    }

    async createConversionPreview(
        content,
        targetFormat
    ) {
        const protectedContent =
            this.protectMarkdownCode(content);

        const stats = this.createConversionStats();

        const converted =
            await this.convertNoteHtmlToMarkdown(
                protectedContent.content,
                targetFormat,
                stats
            );

        const restored =
            this.restoreMarkdownCode(
                converted,
                protectedContent.tokens
            );

        return {
            content: restored,
            changed: restored !== content,
            stats: stats
        };
    }

    createConversionStats() {
        return {
            converted: {
                bold: 0,
                italic: 0,
                strikethrough: 0,
                underline: 0,
                links: 0,
                tables: 0,
                images: 0
            },
            lost: {
                colors: 0,
                backgrounds: 0,
                alignments: 0,
                tableDimensions: 0,
                complexTables: 0
            },
            preservedHtml: {
                colors: 0,
                backgrounds: 0,
                underlines: 0,
                alignments: 0,
                complexTables: 0
            },
            legacyWarning: false
        };
    }

    protectMarkdownCode(content) {
        const tokens = [];
        let protectedContent = String(content);

        protectedContent = protectedContent.replace(
            /(`{3,}|~{3,})[\s\S]*?\1/g,
            (match) => {
                const token =
                    "@@RICH_PASTE_CODE_BLOCK_" +
                    tokens.length +
                    "@@";

                tokens.push({
                    token: token,
                    content: match
                });

                return token;
            }
        );

        protectedContent = protectedContent.replace(
            /`[^`\n]*`/g,
            (match) => {
                const token =
                    "@@RICH_PASTE_INLINE_CODE_" +
                    tokens.length +
                    "@@";

                tokens.push({
                    token: token,
                    content: match
                });

                return token;
            }
        );

        return {
            content: protectedContent,
            tokens: tokens
        };
    }

    restoreMarkdownCode(content, tokens) {
        let restored = String(content);

        for (const item of tokens) {
            restored = restored.replace(
                item.token,
                item.content
            );
        }

        return restored;
    }

    async convertNoteHtmlToMarkdown(
        content,
        targetFormat,
        stats
    ) {
        const parser = new DOMParser();

        const documentNode = parser.parseFromString(
            "<div id=\"rich-paste-root\">" +
            content +
            "</div>",
            "text/html"
        );

        const root = documentNode.getElementById(
            "rich-paste-root"
        );

        if (!root) {
            return content;
        }

        let output = "";

        for (const child of Array.from(root.childNodes)) {
            output +=
                await this.convertExistingHtmlNode(
                    child,
                    targetFormat,
                    stats,
                    false
                );
        }

        return output;
    }

    async convertExistingHtmlNode(
        node,
        targetFormat,
        stats,
        forceHtmlInlineStyles = false
    ) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";

            if (forceHtmlInlineStyles) {
                return this.convertMarkdownStylesToHtml(
                    text
                );
            }

            return text;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return "";
        }

        const element = node;

        const isConvertible =
            this.shouldConvertExistingElement(
                element,
                stats
            );

        const elementNeedsHtml =
            targetFormat === FORMAT_MARKDOWN_PRIORITY &&
            isConvertible &&
            this.htmlElementNeedsHtmlWrapper(
                element
            );

        const childNeedsHtml =
            forceHtmlInlineStyles ||
            elementNeedsHtml;

        const convertedChildren = [];

        for (const child of Array.from(element.childNodes)) {
            convertedChildren.push(
                await this.convertExistingHtmlNode(
                    child,
                    targetFormat,
                    stats,
                    childNeedsHtml
                )
            );
        }

        const content = convertedChildren.join("");

        if (!isConvertible) {
            return this.rebuildUnconvertedElement(
                element,
                content
            );
        }

        return this.convertExistingHtmlElement(
            element,
            content,
            targetFormat,
            stats,
            forceHtmlInlineStyles
        );
    }

        convertMarkdownStylesToHtml(text) {
        let result = String(text || "");

        result = result.replace(
            /\*\*([^*\n]+?)\*\*/g,
            "<strong>$1</strong>"
        );

        result = result.replace(
            /~~([^~\n]+?)~~/g,
            "<s>$1</s>"
        );

        result = result.replace(
            /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
            "<em>$1</em>"
        );

        return result;
    }

    shouldConvertExistingElement(element, stats) {
        const scope = this.settings.convertScope;

        if (scope === "all-compatible") {
            return this.isSupportedConversionElement(
                element
            );
        }

        if (
            element.hasAttribute(
                RICH_PASTE_ATTRIBUTE
            )
        ) {
            return true;
        }

        if (scope === "marked-only") {
            return false;
        }

        const tagName = element.tagName.toLowerCase();
        const styleText =
            element.getAttribute("style") || "";

        const isLegacyElement =
            tagName === "a" ||
            tagName === "b" ||
            tagName === "strong" ||
            tagName === "i" ||
            tagName === "em" ||
            tagName === "u" ||
            tagName === "s" ||
            tagName === "del" ||
            tagName === "strike" ||
            tagName === "font" ||
            tagName === "mark" ||
            tagName === "table" ||
            (
                tagName === "span" &&
                /(?:color|background-color)\s*:/i.test(
                    styleText
                )
            ) ||
            (
                tagName === "div" &&
                /text-align\s*:/i.test(
                    styleText
                )
            );

        if (isLegacyElement && stats) {
            stats.legacyWarning = true;
        }

        return isLegacyElement;
    }

    isSupportedConversionElement(element) {
        return [
            "a",
            "b",
            "strong",
            "i",
            "em",
            "u",
            "s",
            "del",
            "strike",
            "font",
            "span",
            "mark",
            "div",
            "p",
            "br",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td"
        ].includes(
            element.tagName.toLowerCase()
        );
    }

    rebuildUnconvertedElement(element, content) {
        const tagName = element.tagName.toLowerCase();

        if (tagName === "br") {
            return "<br>";
        }

        const attributes = Array.from(
            element.attributes
        )
            .filter((attribute) => {
                return !attribute.name
                    .toLowerCase()
                    .startsWith("on");
            })
            .map((attribute) => {
                return (
                    " " +
                    attribute.name +
                    "=\"" +
                    this.escapeHtmlAttribute(
                        attribute.value
                    ) +
                    "\""
                );
            })
            .join("");

        return (
            "<" +
            tagName +
            attributes +
            ">" +
            content +
            "</" +
            tagName +
            ">"
        );
    }

    async convertExistingHtmlElement(
        element,
        content,
        targetFormat,
        stats,
        forceHtmlInlineStyles = false
    ) {
        const tagName = element.tagName.toLowerCase();

        if (tagName === "table") {
            return this.convertExistingHtmlTable(
                element,
                targetFormat,
                stats
            );
        }

        if (tagName === "br") {
            return "  \n";
        }

        const style = element.style;

        const color = this.getElementTextColor(
            element
        );

        const backgroundColor =
            this.getUsableColor(
                style.backgroundColor
            );

        const bold =
            tagName === "strong" ||
            tagName === "b" ||
            style.fontWeight === "bold" ||
            Number(style.fontWeight) >= 600;

        const italic =
            tagName === "em" ||
            tagName === "i" ||
            style.fontStyle === "italic";

        const underline =
            tagName === "u" ||
            style.textDecoration.includes(
                "underline"
            );

        const strikethrough =
            tagName === "s" ||
            tagName === "del" ||
            tagName === "strike" ||
            style.textDecoration.includes(
                "line-through"
            );

        const alignment =
            this.getElementTextAlignment(
                element
            );

        const hasComplexStyle =
            Boolean(color) ||
            Boolean(backgroundColor) ||
            underline ||
            (
                alignment &&
                alignment !== "left"
            );

        if (tagName === "a") {
            const url = this.getSafeLinkUrl(
                element.getAttribute("href")
            );

            if (url) {
                stats.converted.links += 1;

                const keepLinkAsHtml =
                    targetFormat ===
                    FORMAT_MARKDOWN_PRIORITY &&
                    (
                        forceHtmlInlineStyles ||
                        hasComplexStyle
                    );

                if (keepLinkAsHtml) {
                    content =
                        "<a " +
                        this.createRichPasteAttribute() +
                        " href=\"" +
                        this.escapeHtmlAttribute(
                            url
                        ) +
                        "\">" +
                        content +
                        "</a>";
                } else {
                    content =
                        "[" +
                        content +
                        "](" +
                        this.escapeLinkUrl(url) +
                        ")";
                }
            }
        }

        if (targetFormat === FORMAT_MARKDOWN) {
            if (color) {
                stats.lost.colors += 1;
            }

            if (backgroundColor) {
                stats.lost.backgrounds += 1;
            }

            if (
                alignment &&
                alignment !== "left"
            ) {
                stats.lost.alignments += 1;
            }

            if (bold) {
                stats.converted.bold += 1;
                content = this.wrapStrong(content);
            }

            if (italic) {
                stats.converted.italic += 1;
                content = this.wrapEmphasis(content);
            }

            if (strikethrough) {
                stats.converted.strikethrough += 1;
                content = this.wrapStrikethrough(
                    content
                );
            }

            if (underline) {
                stats.converted.underline += 1;
                content =
                    "<u>" +
                    content +
                    "</u>";
            }

            return content;
        }

        const useHtmlStyles =
            forceHtmlInlineStyles ||
            hasComplexStyle;

        if (!useHtmlStyles) {
            if (bold) {
                stats.converted.bold += 1;
                content = this.wrapStrong(content);
            }

            if (italic) {
                stats.converted.italic += 1;
                content = this.wrapEmphasis(content);
            }

            if (strikethrough) {
                stats.converted.strikethrough += 1;
                content = this.wrapStrikethrough(
                    content
                );
            }

            return content;
        }

        let result = content;

        if (bold) {
            stats.converted.bold += 1;
            result =
                "<strong>" +
                result +
                "</strong>";
        }

        if (italic) {
            stats.converted.italic += 1;
            result =
                "<em>" +
                result +
                "</em>";
        }

        if (strikethrough) {
            stats.converted.strikethrough += 1;
            result =
                "<s>" +
                result +
                "</s>";
        }

        if (underline) {
            stats.preservedHtml.underlines += 1;
            result =
                "<u>" +
                result +
                "</u>";
        }

        if (backgroundColor) {
            stats.preservedHtml.backgrounds += 1;

            result =
                "<mark " +
                this.createRichPasteAttribute() +
                " style=\"background-color:" +
                this.escapeHtmlAttribute(
                    backgroundColor
                ) +
                ";\">" +
                result +
                "</mark>";
        }

        if (color) {
            stats.preservedHtml.colors += 1;

            result =
                "<span " +
                this.createRichPasteAttribute() +
                " style=\"color:" +
                this.escapeHtmlAttribute(
                    color
                ) +
                ";\">" +
                result +
                "</span>";
        }

        if (
            alignment &&
            alignment !== "left"
        ) {
            stats.preservedHtml.alignments += 1;

            result =
                "<div " +
                this.createRichPasteAttribute() +
                " style=\"text-align:" +
                alignment +
                ";\">" +
                result +
                "</div>";
        }

        return result;
    }

    async convertExistingHtmlTable(
        tableElement,
        targetFormat,
        stats
    ) {
        const rows = Array.from(
            tableElement.querySelectorAll("tr")
        );

        if (rows.length === 0) {
            return tableElement.outerHTML;
        }

        const isComplex =
            this.htmlTableIsComplex(
                tableElement,
                rows
            );

        if (
            targetFormat ===
            FORMAT_MARKDOWN_PRIORITY &&
            isComplex
        ) {
            stats.preservedHtml.complexTables += 1;
            return tableElement.outerHTML;
        }

        if (isComplex) {
            stats.lost.complexTables += 1;
        }

        if (
            tableElement.querySelector(
                "colgroup, col"
            ) ||
            /(?:width|height)\s*:/i.test(
                tableElement.getAttribute("style") || ""
            )
        ) {
            stats.lost.tableDimensions += 1;
        }

        const markdown =
            await this.renderHtmlTableAsMarkdown(
                rows
            );

        if (!markdown) {
            return tableElement.outerHTML;
        }

        stats.converted.tables += 1;

        return markdown;
    }
}

class UnusedPluginImageCleanupModal extends Modal {
    constructor(app, files, onConfirm) {
        super(app);

        this.files = files;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();

        contentEl.createEl("h2", {
            text: "清理未使用的插件图片"
        });

        contentEl.createEl("p", {
            text:
                "以下图片位于当前设置的图片保存目录中，且没有在仓库内的 Markdown 笔记中找到引用。确认后会移入 Obsidian 回收站。"
        });

        contentEl.createEl("p", {
            text:
                "本次将处理 " +
                this.files.length +
                " 张图片。"
        });

        const list = contentEl.createEl("ul");

        for (const file of this.files.slice(0, 30)) {
            list.createEl("li", {
                text: file.path
            });
        }

        if (this.files.length > 30) {
            contentEl.createEl("p", {
                text:
                    "其余 " +
                    (this.files.length - 30) +
                    " 张图片未在此处展开。"
            });
        }

        const buttonContainer = contentEl.createDiv(
            "modal-button-container"
        );

        const cancelButton = buttonContainer.createEl(
            "button",
            {
                text: "取消"
            }
        );

        cancelButton.addEventListener(
            "click",
            () => this.close()
        );

        const deleteButton = buttonContainer.createEl(
            "button",
            {
                text: "移入回收站",
                cls: "mod-warning"
            }
        );

        deleteButton.addEventListener(
            "click",
            async () => {
                deleteButton.disabled = true;

                try {
                    await this.onConfirm();
                    this.close();
                } catch (error) {
                    console.error(
                        "清理未使用图片失败:",
                        error
                    );

                    new Notice(
                        "清理未使用图片失败"
                    );

                    deleteButton.disabled = false;
                }
            }
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}

class GlobalImageRepairModal extends Modal {
    constructor(
        app,
        noteCount,
        repairedCount,
        unresolvedCount,
        onConfirm
    ) {
        super(app);

        this.noteCount = noteCount;
        this.repairedCount = repairedCount;
        this.unresolvedCount = unresolvedCount;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();

        contentEl.createEl("h2", {
            text: "修复所有笔记中的旧图片链接"
        });

        contentEl.createEl("p", {
            text:
                "插件将在整个仓库的 Markdown 笔记中查找旧图片地址，并把能够找到对应文件的地址改为稳定的仓库内图片链接。这个操作不会移动或删除图片文件。"
        });

        contentEl.createEl("p", {
            text:
                "将修改 " +
                this.noteCount +
                " 篇笔记，共修复 " +
                this.repairedCount +
                " 个图片地址。"
        });

        if (this.unresolvedCount > 0) {
            contentEl.createEl("p", {
                text:
                    this.unresolvedCount +
                    " 个旧图片地址没有找到唯一对应文件，因此会保持原样。"
            });
        }

        const buttonContainer = contentEl.createDiv(
            "modal-button-container"
        );

        const cancelButton =
            buttonContainer.createEl(
                "button",
                {
                    text: "取消"
                }
            );

        cancelButton.addEventListener(
            "click",
            () => this.close()
        );

        const confirmButton =
            buttonContainer.createEl(
                "button",
                {
                    text: "开始修复",
                    cls: "mod-cta"
                }
            );

        confirmButton.addEventListener(
            "click",
            async () => {
                confirmButton.disabled = true;

                try {
                    await this.onConfirm();
                    this.close();
                } catch (error) {
                    console.error(
                        "全库图片链接修复失败:",
                        error
                    );

                    new Notice(
                        "全库图片链接修复失败，部分笔记可能未修改"
                    );

                    confirmButton.disabled = false;
                }
            }
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}

class RichPasteConversionModal extends Modal {
    constructor(app, plugin, initialFormat, onSelect) {
        super(app);

        this.plugin = plugin;
        this.initialFormat = initialFormat;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.addClass(
            "rich-paste-conversion-modal"
        );

        contentEl.createEl("h2", {
            text: "转换当前笔记格式"
        });

        contentEl.createEl("p", {
            text:
                "选择本次转换的目标格式。此选择只对本次操作生效，不会修改设置中的默认格式。"
        });

        new Setting(contentEl)
            .setName("转换目标格式")
            .setDesc(
                "Markdown 兼容格式会删除无法用 Markdown 表达的视觉样式；Markdown 优先格式会保留这些样式为 HTML。"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(
                        FORMAT_MARKDOWN,
                        "Markdown 兼容格式"
                    )
                    .addOption(
                        FORMAT_MARKDOWN_PRIORITY,
                        "Markdown 优先格式"
                    )
                    .setValue(this.initialFormat)
                    .onChange((value) => {
                        this.initialFormat = value;
                    });
            });

        const info = contentEl.createDiv(
            "rich-paste-conversion-info"
        );

        info.createEl("strong", {
            text: "此操作针对当前打开的笔记"
        });

        info.createEl("p", {
            text:
                "为了避免改动代码示例，使用三个反引号包围的整段内容，以及使用一对反引号包围的短内容，都会保持原样。只有普通正文中的 HTML 会按照当前设置进行转换。"
        });

        const buttonContainer = contentEl.createDiv(
            "modal-button-container"
        );

        const cancelButton = buttonContainer.createEl(
            "button",
            {
                text: "取消"
            }
        );

        cancelButton.addEventListener(
            "click",
            () => this.close()
        );

        const nextButton = buttonContainer.createEl(
            "button",
            {
                text: "检查转换内容",
                cls: "mod-cta"
            }
        );

        nextButton.addEventListener(
            "click",
            () => {
                this.close();
                this.onSelect(this.initialFormat);
            }
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}

class RichPasteConversionConfirmModal extends Modal {
    constructor(app, targetFormat, stats, onConfirm) {
        super(app);

        this.targetFormat = targetFormat;
        this.stats = stats;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.addClass(
            "rich-paste-conversion-modal"
        );

        const formatName =
            this.targetFormat === FORMAT_MARKDOWN
                ? "Markdown 兼容格式"
                : "Markdown 优先格式";

        contentEl.createEl("h2", {
            text: "转换当前笔记格式"
        });

        contentEl.createEl("p", {
            text:
                "即将把当前笔记中的可识别 HTML 转换为 " +
                formatName +
                "。"
        });

        const conversionSection =
            contentEl.createDiv(
                "rich-paste-conversion-section"
            );

        conversionSection.createEl("h3", {
            text:
                "将以下内容转换为 " +
                formatName
        });

        this.renderStatsList(
            conversionSection,
            this.getConvertedItems()
        );

        const impactSection = contentEl.createDiv(
            "rich-paste-conversion-section"
        );

        if (this.targetFormat === FORMAT_MARKDOWN) {
            impactSection.createEl("h3", {
                text:
                    "以下内容无法用纯 Markdown 表达，转换后会丢失或改变"
            });

            this.renderStatsList(
                impactSection,
                this.getLostItems()
            );
        } else {
            impactSection.createEl("h3", {
                text:
                    "以下内容无法安全转换为 Markdown，将继续保留为 HTML"
            });

            this.renderStatsList(
                impactSection,
                this.getPreservedItems()
            );
        }

        if (this.stats.legacyWarning) {
            const warning = contentEl.createDiv(
                "rich-paste-conversion-warning"
            );

            warning.createEl("strong", {
                text: "旧版本 HTML 检测提示"
            });

            warning.createEl("p", {
                text:
                    "当前笔记包含没有插件标记的旧版本 HTML。插件会按兼容规则尝试转换，但无法完全判断这些内容是否由本插件生成。"
            });
        }

        const buttonContainer = contentEl.createDiv(
            "modal-button-container"
        );

        const cancelButton = buttonContainer.createEl(
            "button",
            {
                text: "取消"
            }
        );

        cancelButton.addEventListener(
            "click",
            () => this.close()
        );

        const confirmButton = buttonContainer.createEl(
            "button",
            {
                text: "开始转换",
                cls: "mod-cta"
            }
        );

        confirmButton.addEventListener(
            "click",
            () => {
                this.close();
                this.onConfirm();
            }
        );
    }

    renderStatsList(container, items) {
        const list = container.createEl("ul");

        for (const item of items) {
            list.createEl("li", {
                text: item
            });
        }
    }

    getConvertedItems() {
        const converted = this.stats.converted;
        const items = [];

        this.addCount(
            items,
            converted.bold,
            "处加粗"
        );

        this.addCount(
            items,
            converted.italic,
            "处斜体"
        );

        this.addCount(
            items,
            converted.strikethrough,
            "处删除线"
        );

        this.addCount(
            items,
            converted.underline,
            "处下划线"
        );

        this.addCount(
            items,
            converted.links,
            "个链接"
        );

        this.addCount(
            items,
            converted.tables,
            "个简单表格"
        );

        if (items.length === 0) {
            items.push("未检测到可统计的样式转换");
        }

        return items;
    }

    getLostItems() {
        const lost = this.stats.lost;
        const items = [];

        this.addCount(
            items,
            lost.colors,
            "处字体颜色"
        );

        this.addCount(
            items,
            lost.backgrounds,
            "处背景高亮"
        );

        this.addCount(
            items,
            lost.alignments,
            "处段落对齐"
        );

        this.addCount(
            items,
            lost.tableDimensions,
            "个表格的列宽或行高"
        );

        this.addCount(
            items,
            lost.complexTables,
            "个复杂表格的视觉样式"
        );

        if (items.length === 0) {
            items.push("未检测到明确会丢失的视觉样式");
        }

        return items;
    }

    getPreservedItems() {
        const preserved = this.stats.preservedHtml;
        const items = [];

        this.addCount(
            items,
            preserved.colors,
            "处字体颜色保留为 HTML"
        );

        this.addCount(
            items,
            preserved.backgrounds,
            "处背景高亮保留为 HTML"
        );

        this.addCount(
            items,
            preserved.underlines,
            "处下划线保留为 HTML"
        );

        this.addCount(
            items,
            preserved.alignments,
            "处段落对齐保留为 HTML"
        );

        this.addCount(
            items,
            preserved.complexTables,
            "个复杂表格保留为 HTML"
        );

        if (items.length === 0) {
            items.push("未检测到需要保留为 HTML 的复杂样式");
        }

        return items;
    }

    addCount(items, count, suffix) {
        if (count > 0) {
            items.push(count + suffix);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

class RichPasteSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h2", {
            text: "Rich Paste Converter"
        });

        containerEl.createEl("h3", {
            text: "粘贴设置"
        });

        new Setting(containerEl)
            .setName("粘贴来源")
            .setDesc(
                "仅处理 IMA 只接管 application/x-ima-fragment；自动检测会优先处理 IMA，没有 IMA 数据时再处理标准 text/html；仅处理标准 HTML 只接管 text/html。"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(
                        "ima",
                        "仅处理 IMA"
                    )
                    .addOption(
                        "auto",
                        "自动检测"
                    )
                    .addOption(
                        "html",
                        "仅处理标准 HTML"
                    )
                    .setValue(
                        this.plugin.settings.pasteSource
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.pasteSource =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("粘贴输出格式")
            .setDesc(
                "HTML 富格式可以保留颜色、背景高亮、复杂表格和对齐；Markdown 兼容格式会删除部分无法表达的视觉样式；Markdown 优先格式会在必要时保留 HTML。"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(
                        FORMAT_HTML,
                        "HTML 富格式"
                    )
                    .addOption(
                        FORMAT_MARKDOWN,
                        "Markdown 兼容格式"
                    )
                    .addOption(
                        FORMAT_MARKDOWN_PRIORITY,
                        "Markdown 优先格式"
                    )
                    .setValue(
                        this.plugin.settings.pasteFormat
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.pasteFormat =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("图片保存目录")
            .setDesc(
                "复制富文本中的网络图片时，图片会保存到当前仓库的这个目录。修改目录只会影响以后保存的新图片，不会自动移动已经存在的图片。"
            )
            .addText((text) => {
                text
                    .setPlaceholder(IMAGE_FOLDER)
                    .setValue(
                        this.plugin.settings.imageFolder
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.imageFolder =
                            value.trim() || IMAGE_FOLDER;

                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl("h3", {
            text: "图片维护"
        });

        containerEl.createEl("p", {
            text:
                "如果笔记中仍有旧的 app:// 图片地址，可以使用下面的功能扫描整个仓库并统一修复。插件会在仓库中寻找图片文件，不会删除或移动图片。"
        });

        new Setting(containerEl)
            .setName("修复所有笔记中的旧图片链接")
            .setDesc(
                "适用于重启 Obsidian 后无法显示的旧图片。修复前会显示将要修改的笔记数量和图片数量。"
            )
            .addButton((button) => {
                button
                    .setButtonText("开始全库修复")
                    .setTooltip(
                        "扫描所有 Markdown 笔记中的旧图片地址"
                    )
                    .onClick(async () => {
                        await this.plugin
                            .repairAllNoteImageLinks();
                    });
            });

        new Setting(containerEl)
            .setName("清理未使用的插件图片")
            .setDesc(
                "检查当前图片保存目录中的插件图片。只有没有被仓库内 Markdown 笔记引用的图片才会列出，确认后移入回收站。修改图片保存目录后，旧目录中的图片不会被此功能处理。"
            )
            .addButton((button) => {
                button
                    .setButtonText("检查并清理")
                    .setTooltip(
                        "检查当前图片保存目录中未被引用的插件图片"
                    )
                    .onClick(async () => {
                        await this.plugin
                            .cleanUnusedPluginImages();
                    });
            });

        new Setting(containerEl)
            .setName("粘贴表格时显示限制提示")
            .setDesc(
                "HTML 表格可以保留更多样式，但粘贴后不是 Obsidian 原生的可交互 Markdown 表格。"
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.showTableNotice
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.showTableNotice =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl("h3", {
            text: "当前笔记转换"
        });

        new Setting(containerEl)
            .setName("显示“转换当前笔记格式”侧边栏按钮")
            .setDesc(
                "控制左侧 Ribbon 区域中的按钮。开启后，点击按钮会打开当前笔记转换窗口；关闭后仍可通过命令面板执行转换。"
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.showConversionRibbon
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.showConversionRibbon =
                            value;

                        await this.plugin.saveSettings();
                        this.plugin.updateConversionRibbon();
                    });
            });

        new Setting(containerEl)
            .setName("当前笔记转换默认格式")
            .setDesc(
                "只决定左侧转换按钮打开窗口时的默认选择，不影响直接粘贴格式，也不会限制本次操作临时切换的格式。"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(
                        FORMAT_MARKDOWN,
                        "Markdown 兼容格式"
                    )
                    .addOption(
                        FORMAT_MARKDOWN_PRIORITY,
                        "Markdown 优先格式"
                    )
                    .setValue(
                        this.plugin.settings.conversionFormat
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.conversionFormat =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("当前笔记转换范围")
            .setDesc(
                "控制左侧“转换当前笔记格式”按钮和相关命令处理哪些 HTML。仅转换带插件标记的内容最安全；旧版本 HTML 没有标记，只能按兼容规则识别；转换所有可识别 HTML 可能影响手动编写的 HTML。"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(
                        "marked-only",
                        "仅转换带插件标记的 HTML"
                    )
                    .addOption(
                        "plugin-and-legacy",
                        "转换插件标记和旧版本 HTML"
                    )
                    .addOption(
                        "all-compatible",
                        "转换当前笔记中所有可识别 HTML"
                    )
                    .setValue(
                        this.plugin.settings.convertScope
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.convertScope =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("转换前显示确认窗口")
            .setDesc(
                "转换前列出将转换的内容以及可能丢失或继续保留为 HTML 的内容。"
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.confirmBeforeConversion
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.confirmBeforeConversion =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl("h3", {
            text: "编辑模式兼容"
        });

        new Setting(containerEl)
            .setName("在 Markdown 模式中使用 HTML 强调")
            .setDesc(
                "关闭时，加粗、斜体和删除线会转换为 Markdown 标记。开启后，这些样式会保留为 HTML 标签，以避免部分中文标点附近在编辑模式中显示异常。"
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.useHtmlEmphasisInMarkdown === true
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.useHtmlEmphasisInMarkdown =
                            value;

                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl("h3", {
            text: "来源说明"
        });

        containerEl.createEl("p", {
            text:
                "IMA 使用 application/x-ima-fragment 专用剪贴板数据。其他软件通常提供 text/html 或 text/plain。插件按剪贴板数据类型和标准 HTML 结构处理，不需要为每个笔记软件单独设置选项。"
        });
    }
}

module.exports = ImaEnhancedPastePlugin;
