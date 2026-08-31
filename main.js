const { Plugin, Notice } = require("obsidian");

const IMA_MIME_TYPE = "application/x-ima-fragment";

class ImaEnhancedPastePlugin extends Plugin {
    async onload() {
        this.registerDomEvent(
            document,
            "paste",
            (event) => {
                this.handlePaste(event);
            },
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
        const elements = this.getEventElements(event);

        const propertySelectors = [
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
        ];

        const selector = propertySelectors.join(", ");

        for (const element of elements) {
            if (element.closest(selector)) {
                return true;
            }
        }

        return false;
    }

    isTextInputTarget(event) {
        const elements = this.getEventElements(event);

        for (const element of elements) {
            if (
                element.matches(
                    "input, textarea, select, button"
                )
            ) {
                return true;
            }

            if (
                element.closest(
                    "input, textarea, select, button"
                )
            ) {
                return true;
            }
        }

        return false;
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

    handlePaste(event) {
        if (!event || event.defaultPrevented) {
            return;
        }

        if (!event.clipboardData) {
            return;
        }

        if (!this.isMarkdownEditorTarget(event)) {
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

        const editor = this.getActiveEditor();

        if (!editor) {
            return;
        }

        try {
            const imaData = this.decodeImaData(encodedData);
            const markdown = this.convertImaToMarkdown(imaData);

            if (!markdown) {
                throw new Error("IMA 内容为空");
            }

            event.preventDefault();
            event.stopPropagation();

            editor.replaceSelection(markdown);

            new Notice("已按 IMA 格式粘贴");
        } catch (error) {
            console.error(
                "IMA Enhanced Paste parsing failed:",
                error
            );

            new Notice(
                "IMA 内容解析失败，已使用普通粘贴"
            );
        }
    }

    pasteFromImaClipboard(editor) {
        navigator.clipboard
            .read()
            .then(async (clipboardItems) => {
                let encodedData = null;

                for (const item of clipboardItems) {
                    if (item.types.includes(IMA_MIME_TYPE)) {
                        const blob = await item.getType(
                            IMA_MIME_TYPE
                        );

                        encodedData = await blob.text();
                        break;
                    }
                }

                if (!encodedData) {
                    new Notice(
                        "当前剪贴板中没有 IMA 内容"
                    );

                    return;
                }

                const imaData = this.decodeImaData(encodedData);
                const markdown = this.convertImaToMarkdown(
                    imaData
                );

                if (!markdown) {
                    throw new Error("IMA 内容为空");
                }

                editor.replaceSelection(markdown);

                new Notice("已按 IMA 格式粘贴");
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
            decodedText = this.decodeBase64Utf8(
                decodedText
            );
        } catch (error) {
            decodedText = encodedData;
        }

        decodedText = decodeURIComponent(decodedText);

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
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new TextDecoder("utf-8").decode(bytes);
    }

    convertImaToMarkdown(nodes) {
        const blocks = [];

        for (const node of nodes) {
            const block = this.renderBlock(node);

            if (block === null) {
                continue;
            }

            blocks.push(block);
        }

        while (
            blocks.length > 0 &&
            blocks[blocks.length - 1] === ""
        ) {
            blocks.pop();
        }

        return blocks.join("\n\n");
    }

    renderBlock(node) {
        if (!node || typeof node !== "object") {
            return null;
        }

        const type = node.type || "p";

        const children = Array.isArray(node.children)
            ? node.children
            : [];

        const isEmptyBlock =
            children.length === 0 ||
            children.every((child) => {
                return (
                    child &&
                    typeof child === "object" &&
                    typeof child.text === "string" &&
                    child.text.length === 0
                );
            });

        if (isEmptyBlock) {
            return "";
        }

        const content = children
            .map((child) => this.renderInline(child))
            .join("");

        if (type === "h1") {
            return "# " + this.removeLeadingHeadingMarks(
                content
            );
        }

        if (type === "h2") {
            return "## " + this.removeLeadingHeadingMarks(
                content
            );
        }

        if (type === "h3") {
            return "### " + this.removeLeadingHeadingMarks(
                content
            );
        }

        if (type === "h4") {
            return "#### " + this.removeLeadingHeadingMarks(
                content
            );
        }

        if (type === "h5") {
            return "##### " + this.removeLeadingHeadingMarks(
                content
            );
        }

        if (type === "h6") {
            return "###### " + this.removeLeadingHeadingMarks(
                content
            );
        }

        if (type === "blockquote") {
            return content
                .split("\n")
                .map((line) => "> " + line)
                .join("\n");
        }

        if (type === "li") {
            return "- " + content;
        }

        if (type === "ul" || type === "ol") {
            return content;
        }

        return content;
    }

    renderInline(node) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (node.type === "a") {
            const children = Array.isArray(node.children)
                ? node.children
                : [];

            const label = children
                .map((child) => this.renderInline(child))
                .join("");

            const url = typeof node.url === "string"
                ? node.url
                : "";

            if (!url) {
                return label;
            }

            return "[" + label + "](" +
                this.escapeLinkUrl(url) +
                ")";
        }

        if (Array.isArray(node.children)) {
            return node.children
                .map((child) => this.renderInline(child))
                .join("");
        }

        if (typeof node.text !== "string") {
            return "";
        }

        let text = node.text;

        text = text.replace(/\r\n/g, "\n");
        text = text.replace(/\r/g, "\n");
        text = text.replace(/\n/g, "  \n");

        if (node.bold && node.italic) {
            text = "***" + text + "***";
        } else if (node.bold) {
            text = "**" + text + "**";
        } else if (node.italic) {
            text = "*" + text + "*";
        }

        if (node.underline) {
            text = "<u>" + text + "</u>";
        }

        if (node.strikethrough) {
            text = "~~" + text + "~~";
        }

        return text;
    }

    removeLeadingHeadingMarks(text) {
        return text.replace(/^[#\s]+/, "");
    }

    escapeLinkUrl(url) {
        return url.replace(/\)/g, "\\)");
    }
}

module.exports = ImaEnhancedPastePlugin;
