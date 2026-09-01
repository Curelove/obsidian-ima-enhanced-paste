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
            if (element.matches("input, textarea, select, button")) {
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

        /*
         * 图片下载是异步操作。
         * 必须立刻阻止 Obsidian 的默认粘贴，
         * 否则默认内容会先被插入。
         */
        event.preventDefault();
        event.stopPropagation();

        const selection = {
            from: editor.getCursor("from"),
            to: editor.getCursor("to")
        };

        this.pasteImaData(encodedData, editor, selection);
    }

    async pasteImaData(encodedData, editor, selection) {
        try {
            this.imageCounter = 0;
            this.imageFailureCount = 0;

            const imaData = this.decodeImaData(encodedData);

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
                    " 张图片下载失败，已保留临时网络链接"
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

    async convertImaToMarkdown(nodes) {
        const blocks = [];

        for (const node of nodes) {
            const block = await this.renderBlock(node);

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

        /*
         * IMA 图片节点。
         * 图片会保存到本地仓库的 IMA Images 文件夹。
         */
        if (type === "cloud_image") {
            return await this.renderCloudImage(node);
        }

        /*
         * IMA 复制时会插入 cursor-side 节点。
         *
         * 它本身不是正文，但其中可能包含 cloud_image。
         * 不能直接忽略整个节点，否则其中的图片也会被忽略。
         */
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

        const content = await this.renderChildren(children);

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
            content += await this.renderInline(child);
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
            const children = Array.isArray(node.children)
                ? node.children
                : [];

            const label = await this.renderChildren(children);

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
            return await this.renderChildren(node.children);
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

            /*
             * 下载失败时仍保留 IMA 图片的网络地址。
             * 该地址可能有时效，但至少不会让图片位置完全消失。
             */
            return "![" +
                this.escapeMarkdownAlt("IMA 图片（下载失败）") +
                "](" +
                this.escapeLinkUrl(url) +
                ")";
        }
    }

    async downloadImage(url) {
        await this.ensureImageFolder();

        /*
         * IMA 的图片 URL 带有会过期的签名参数。
         * 但同一张图片的“域名 + 路径”通常保持不变。
         *
         * 因此文件名只根据不含签名参数的稳定地址生成。
         * 同一图片再次粘贴时，会直接复用已有文件。
         */
        const extension = this.getImageExtension(url, "");

        const fileName = await this.createImageFileName(
            url,
            extension
        );

        const imagePath = IMAGE_FOLDER + "/" + fileName;

        /*
         * 文件已存在时，直接复用，不重新请求 IMA 图片服务器，
         * 也不会在 IMA Images 中产生重复图片。
         */
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
            /*
             * 如果文件夹恰好被其他操作创建，
             * 再次检查即可。
             */
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

            /*
             * 删除 q-signature、q-sign-time 等临时签名参数。
             * 同一图片即使下次复制时签名变了，仍会得到相同文件名。
             */
            return parsedUrl.origin + parsedUrl.pathname;
        } catch (error) {
            /*
             * URL 无法解析时，退回到删除 ? 后内容的方式。
             */
            return String(url).split("?")[0];
        }
    }

    hashText(text) {
        /*
         * FNV-1a 32-bit hash。
         * 用于将图片稳定地址转换成简短、安全的文件名。
         */
        let hash = 2166136261;

        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    getImageExtension(url, contentType) {
        const normalizedType = String(contentType || "")
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

        if (contentTypeExtensions[normalizedType]) {
            return contentTypeExtensions[normalizedType];
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
            console.warn("Unable to determine image extension:", error);
        }

        return "png";
    }

    padNumber(value) {
        return String(value).padStart(2, "0");
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
}

module.exports = ImaEnhancedPastePlugin;
