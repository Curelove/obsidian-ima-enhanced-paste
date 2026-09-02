# IMA Enhanced Paste

一个用于 Obsidian 的 IMA 增强粘贴插件。

IMA 中的文字复制到 Obsidian 后，使用普通 Ctrl + V 有时会丢失原有换行。本插件读取 IMA 提供的自定义剪贴板格式，在尽量保留格式的同时恢复换行。

## 功能

- 保留从 IMA 复制内容中的换行。
- 支持普通段落。
- 支持一级至六级标题。
- 支持加粗文字。
- 支持斜体文字。
- 支持下划线文字。
- 支持删除线文字。
- 支持链接。
- 支持 IMA 中的空段落。
- 仅在检测到 IMA 自定义剪贴板格式时接管 Ctrl + V。
- 从网页、记事本、Word 或其他软件复制时，继续使用 Obsidian 原本的粘贴行为。
- 提供清理 IMA 导出 Markdown 空行占位符的命令。

## 使用方法

1. 在 IMA 中选中需要复制的内容。
2. 按 Ctrl + C。
3. 打开 Obsidian 中的 Markdown 笔记。
4. 将光标放在需要插入内容的位置。
5. 按 Ctrl + V。

如果剪贴板中包含 IMA 的自定义格式，插件会自动转换内容并插入当前笔记。

如果剪贴板中不包含 IMA 格式，插件不会干预，Obsidian 会继续使用默认粘贴功能。

## 支持的格式

IMA 中的内容会尽量转换成 Obsidian Markdown：

| IMA 格式 | 转换结果 |
| --- | --- |
| 普通文字 | 普通文字 |
| 加粗 | `**加粗文字**` |
| 斜体 | `*斜体文字*` |
| 加粗并斜体 | `***文字***` |
| 下划线 | `<u>下划线文字</u>` |
| 删除线 | `~~删除线文字~~` |
| 链接 | `[链接文字](https://example.com)` |
| 一级标题 | `# 标题` |
| 二级标题 | `## 标题` |

字体、字号、字体颜色、背景色、行高等视觉样式不一定能够保留。这些样式不属于标准 Markdown 的完整功能范围。

## 清理 IMA 导出内容

IMA 导出的 Markdown 中，空行有时会表现为：

`&#x20;`

或：

`&#x20;\`

本插件提供了“清理 IMA 导出空行占位符”命令，可以将单独占据一整行的这些内容转换为空行。

该命令不会删除正文中正常出现的同名字符。

## 命令

插件目前提供以下命令：

- 从 IMA 剪贴板粘贴
- 清理 IMA 导出空行占位符

“从 IMA 剪贴板粘贴”可以在 Ctrl + V 没有自动触发时作为备用方式使用。

## 与其他粘贴插件的兼容性

如果同时使用 Paste Mode 或 Paste Reformatter，建议不要让它们同时接管默认 Ctrl + V。

测试本插件时，建议暂时关闭：

- Paste Mode 的默认粘贴接管功能；
- Paste Reformatter 的默认粘贴接管功能。

多个插件同时处理一次粘贴操作，可能导致内容重复、格式被二次转换或粘贴行为异常。

## 安装方式

### 方式一：使用 BRAT 安装测试版

1. 在 Obsidian 的社区插件中安装并启用 BRAT。
2. 打开 BRAT 设置。
3. 添加本 GitHub 仓库：

`你的 GitHub 用户名/obsidian-ima-enhanced-paste`

4. 回到 Obsidian 的第三方插件列表。
5. 启用 IMA Enhanced Paste。

### 方式二：手动安装

将以下文件放入当前仓库的插件目录：

`.obsidian/plugins/ima-enhanced-paste/`

需要包含：

- `manifest.json`
- `main.js`

然后重新加载 Obsidian 的第三方插件列表，并启用本插件。

## 隐私

本插件：

- 不上传剪贴板内容；
- 不读取整个 Obsidian 仓库；
- 不访问网络；
- 只在粘贴操作发生时读取剪贴板中的相关数据。

## 兼容性

- Obsidian Windows 桌面版；
- 需要 IMA 提供 `application/x-ima-fragment` 剪贴板格式。

本插件依赖 IMA 的自定义剪贴板格式。如果 IMA 将来修改该格式，插件可能需要更新。

This plugin depends on IMA's custom clipboard format. Future changes to IMA may require updates to this plugin.

## 免责声明

本插件与 IMA 和 Obsidian 没有隶属关系，也不是由 IMA 或 Obsidian 官方发布。

This plugin is not affiliated with IMA or Obsidian.

## License

MIT

## 更新记录
### 0.2.2

- 修复从 IMA 粘贴内容时，光标位置在标题输入框，但插件仍会把转换结果写入正文的问题。
- 现在可以直接把从 IMA 复制的文本粘贴到标题，如果在标题区域粘贴的 IMA 内容中包含图片，图片会被忽略。

### 0.2.1

- 修复从 IMA 粘贴内容时未覆盖已选中文字的问题。
- 现在粘贴行为与 Obsidian 默认粘贴一致：有选区时替换选区，无选区时在光标位置插入。

### 0.2.0

- 支持识别 IMA 内容中的图片。
- 图片会下载并保存到仓库根目录的 `IMA Images` 文件夹。
- 同一张图片再次粘贴时会复用已有本地文件，避免重复下载。

### 0.1.1

- 修复笔记属性区域的粘贴兼容性问题。

### 0.1.0

- 首次发布。
- 支持从 IMA 粘贴文字、换行和基本格式。
