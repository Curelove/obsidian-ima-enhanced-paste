const { Plugin, Notice, requestUrl } = require("obsidian");

const IMA_MIME_TYPE = "application/x-ima-fragment";
const IMAGE_FOLDER = "IMA Images";

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

    getInlineTitleElement(event) {
        const elements = this.getEventElements(event);

        const selector = [
            ".inline-title",
            ".inline-title-input",
            "[data-inline-title]"
        ].join(", ");

        for (const element of elements) {
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
        if (!event || event.defaultPrevented) {
            return;
        }

        if (!event.clipboardData) {
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

        const types = Array.from(
            event.clipboardData.types || []
        );

        if (!types.includes(IMA_MIME_TYPE)) {
            return;
        }

        const encodedData = event.clipboardData.getData(
            IMA_MIME_TYPE
        );

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

        this.pasteImaData(
            encodedData,
            editor,
            selection
        );
    }

    async pasteImaData(
        encodedData,
        editor,
        selection
    ) {
        try {
            this.imageCounter = 0;
            this.imageFailureCount = 0;

            const imaData = this.decodeImaData(
                encodedData
            );

            const markdown = await this.convertImaToMarkdown(
                imaData
            );

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
                    " 张图片下载失败，" +
                    "已保留临时网络链接"
                );
            } else {
                new Notice("已按 IMA 格式粘贴");
            }
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
            const imaData = this.decodeImaData(
                encodedData
            );

            const titleText = this.convertImaToTitleText(
                imaData
            );

            if (!titleText) {
                throw new Error("IMA 标题内容为空");
            }

            const titleElement =
                this.getInlineTitleElement(event);

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
                    const selection =
                        window.getSelection();

                    if (
                        !selection ||
                        selection.rangeCount === 0
                    ) {
                        throw new Error(
                            "无法取得标题选区"
                        );
                    }

                    const range =
                        selection.getRangeAt(0);

                    range.deleteContents();

                    const textNode =
                        document.createTextNode(
                            titleText
                        );

                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.collapse(true);

                    selection.removeAllRanges();
                    selection.addRange(range);

                    titleElement.dispatchEvent(
                        new InputEvent("input", {
                            bubbles: true,
                            inputType: "insertText",
                            data: titleText
                        })
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

    convertImaToTitleText(nodes) {
        const parts = [];

        for (const node of nodes) {
            const text = this.extractPlainText(node);

            if (text) {
                parts.push(text);
            }
        }

        return parts
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
            node.type === "image"
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
            .map((child) => {
                return this.extractPlainText(child);
            })
            .join("");
    }

    pasteFromImaClipboard(editor) {
        navigator.clipboard
            .read()
            .then(async (clipboardItems) => {
                let encodedData = null;

                for (const item of clipboardItems) {
                    if (
                        item.types.includes(
                            IMA_MIME_TYPE
                        )
                    ) {
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
        let decodedText = encodedData;

        try {
            decodedText = this.decodeBase64Utf8(
                decodedText
            );
        } catch (error) {
            decodedText = encodedData;
        }

        decodedText = decodeURIComponent(
            decodedText
        );

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

        return new TextDecoder("utf-8").decode(
            bytes
        );
    }

    async convertImaToMarkdown(nodes) {
        const blocks = [];

        for (const node of nodes) {
            const block = await this.renderBlock(
                node
            );

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

    async renderBlock(node) {
        if (!node || typeof node !== "object") {
            return null;
        }

        const type = node.type || "p";

        const children = Array.isArray(node.children)
            ? node.children
            : [];

        if (type === "cloud_image") {
            return await this.renderCloudImage(node);
        }

        if (type === "cursor-side") {
            return await this.renderChildren(children);
        }

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

        const content = await this.renderChildren(
            children
        );

        if (type === "h1") {
            return "# " +
                this.removeLeadingHeadingMarks(
                    content
                );
        }

        if (type === "h2") {
            return "## " +
                this.removeLeadingHeadingMarks(
                    content
                );
        }

        if (type === "h3") {
            return "### " +
                this.removeLeadingHeadingMarks(
                    content
                );
        }

        if (type === "h4") {
            return "#### " +
                this.removeLeadingHeadingMarks(
                    content
                );
        }

        if (type === "h5") {
            return "##### " +
                this.removeLeadingHeadingMarks(
                    content
                );
        }

        if (type === "h6") {
            return "###### " +
                this.removeLeadingHeadingMarks(
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

    async renderChildren(children) {
        let content = "";

        for (const child of children) {
            content += await this.renderInline(
                child
            );
        }

        return content;
    }

    async renderInline(node) {
        if (!node || typeof node !== "object") {
            return "";
        }

        if (node.type === "cloud_image") {
            return await this.renderCloudImage(node);
        }

        if (node.type === "a") {
            const children = Array.isArray(
                node.children
            )
                ? node.children
                : [];

            const label = await this.renderChildren(
                children
            );

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
            return await this.renderChildren(
                node.children
            );
        }

        if (typeof node.text !== "string") {
            return "";
        }

        let text = node.text;

        text = text.replace(
            /\r\n/g,
            "\n"
        );

        text = text.replace(
            /\r/g,
            "\n"
        );

        text = text.replace(
            /\n/g,
            "  \n"
        );

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

    async renderCloudImage(node) {
        const url = typeof node.url === "string"
            ? node.url
            : "";

        if (!url) {
            this.imageFailureCount += 1;

            return "> [!warning] " +
                "IMA 图片没有可用地址";
        }

        try {
            const imagePath =
                await this.downloadImage(url);

            return "![" +
                this.escapeMarkdownAlt("IMA 图片") +
                "](" +
                this.escapeLinkUrl(
                    this.app.vault.adapter
                        .getResourcePath(imagePath)
                ) +
                ")";
        } catch (error) {
            console.error(
                "IMA image download failed:",
                error
            );

            this.imageFailureCount += 1;

            return "![" +
                this.escapeMarkdownAlt(
                    "IMA 图片（下载失败）"
                ) +
                "](" +
                this.escapeLinkUrl(url) +
                ")";
        }
    }

    async downloadImage(url) {
        await this.ensureImageFolder();

        const extension = this.getImageExtension(
            url,
            ""
        );

        const fileName =
            await this.createImageFileName(
                url,
                extension
            );

        const imagePath =
            IMAGE_FOLDER + "/" + fileName;

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

        if (
            await adapter.exists(IMAGE_FOLDER)
        ) {
            return;
        }

        try {
            await this.app.vault.createFolder(
                IMAGE_FOLDER
            );
        } catch (error) {
            if (
                !(await adapter.exists(
                    IMAGE_FOLDER
                ))
            ) {
                throw error;
            }
        }
    }

    async createImageFileName(url, extension) {
        const stableUrl =
            this.getStableImageUrl(url);

        const hash = this.hashText(stableUrl);

        return "ima-image-" +
            hash +
            "." +
            extension;
    }

    getStableImageUrl(url) {
        try {
            const parsedUrl = new URL(url);

            return parsedUrl.origin +
                parsedUrl.pathname;
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
            hash = Math.imul(
                hash,
                16777619
            );
        }

        return (hash >>> 0)
            .toString(16)
            .padStart(8, "0");
    }

    getImageExtension(url, contentType) {
        const normalizedType = String(
            contentType || ""
        )
            .toLowerCase()
            .split(";")[0]
            .trim();

        const contentTypeExtensions = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
            "image/avif": "avif",
            "image/svg+xml": "svg"
        };

        if (
            contentTypeExtensions[
                normalizedType
            ]
        ) {
            return contentTypeExtensions[
                normalizedType
            ];
        }

        try {
            const pathname = new URL(url)
                .pathname;

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
        return text.replace(
            /^[#\s]+/,
            ""
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
}

module.exports = ImaEnhancedPastePlugin;
