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

    isMarkdownEditorTarget(target) {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        if (target.closest("input, textarea, select, button")) {
            return false;
        }

        return Boolean(
            target.closest(".cm-editor, .markdown-source-view, .markdown-preview-view")
        );
    }

    handlePaste(event) {
        if (!event || event.defaultPrevented) {
            return;
        }

        if (!event.clipboardData) {
            return;
        }

        if (!this.isMarkdownEditorTarget(event.target)) {
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
            console.error("IMA Enhanced Paste parsing failed:", error);
            new Notice("IMA 内容解析失败，已使用普通粘贴");
        }
    }

    pasteFromImaClipboard(editor) {
        navigator.clipboard
            .read()
            .then(async (clipboardItems) => {
                let encodedData = null;

                for (const item of clipboardItems) {
                    if (item.types.includes(IMA_MIME_TYPE)) {
                        const blob = await item.getType(IMA_MIME_TYPE);
                        encodedData = await blob.text();
                        break;
                    }
                }

                if (!encodedData) {
                    new Notice("当前剪贴板中没有 IMA 内容");
                    return;
                }

                const imaData = this.decodeImaData(encodedData);
                const markdown = this.convertImaToMarkdown(imaData);

                if (!markdown) {
                    throw new Error("IMA 内容为空");
                }

                editor.replaceSelection(markdown);
                new Notice("已按 IMA 格式粘贴");
            })
            .catch((error) => {
                console.error("IMA Enhanced Paste command failed:", error);
                new Notice("读取 IMA 剪贴板失败");
            });
    }

    decodeImaData(encodedData) {
        let decodedText = encodedData;

        /*
         * IMA 当前提供的内容是：
         *
         * Base64
         *   ↓
         * URL 编码后的 JSON
         *   ↓
         * IMA 节点数组
         *
         * 因此这里先 Base64 解码，再 URL 解码。
         */

        try {
            decodedText = this.decodeBase64Utf8(decodedText);
        } catch (error) {
            /*
             * 如果未来 IMA 改成直接提供 URL 编码内容，
             * 这里保留直接处理的可能性。
             */
            decodedText = encodedData;
        }

        decodedText = decodeURIComponent(decodedText);

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

    convertImaToMarkdown(nodes) {
        const blocks = [];

        for (const node of nodes) {
            const block = this.renderBlock(node);

            if (block === null) {
                continue;
            }

            blocks.push(block);
        }

        /*
         * IMA 有时会在末尾附带空段落。
         * 删除末尾多余空行，但保留正文中间的空段落。
         */
        while (blocks.length > 0 && blocks[blocks.length - 1] === "") {
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

        if (type === "ul" || type === "ol") {
            return content;
        }

        if (type === "li") {
            return "- " + content;
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
                .map((child) => this.renderInline(child, true))
                .join("");

            const url = typeof node.url === "string"
                ? node.url
                : "";

            if (!url) {
                return label;
            }

            return "[" + label + "](" + this.escapeLinkUrl(url) + ")";
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

        /*
         * 将 IMA 文本内部的换行转换成 Markdown 硬换行。
         * 两个空格加换行可以确保 Obsidian 阅读模式显示换行。
         */
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
