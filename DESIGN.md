---
name: "novix.ai"
description: "编辑策划工作台的已实现视觉系统"
colors:
  panel: "rgb(251 252 253)"
  surface: "rgb(240 243 244)"
  surface-2: "rgb(230 237 239)"
  border: "rgb(220 227 230)"
  text: "rgb(23 43 53)"
  muted: "rgb(91 110 119)"
  accent: "rgb(33 94 102)"
  accent-hover: "rgb(24 75 82)"
  on-accent: "rgb(255 255 255)"
  panel-dark: "rgb(22 32 38)"
  surface-dark: "rgb(17 26 31)"
  surface-2-dark: "rgb(35 48 55)"
  border-dark: "rgb(53 71 79)"
  text-dark: "rgb(221 231 235)"
  muted-dark: "rgb(159 179 188)"
  accent-dark: "rgb(113 182 190)"
  accent-hover-dark: "rgb(145 205 211)"
  on-accent-dark: "rgb(13 39 45)"
typography:
  body:
    fontFamily: "'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  story-title:
    fontFamily: "'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: "'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 650
  field-label:
    fontFamily: "'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
  button:
    fontFamily: "'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.4
rounded:
  control: "6px"
  utility: "0.6rem"
  pill: "9999px"
spacing:
  button-block: "8px"
  button-inline: "13px"
  field-block: "10px"
  field-inline: "12px"
  page-block: "42px"
  page-inline: "52px"
  section-top: "25px"
  section-bottom: "27px"
  section-heading-gap: "21px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  input-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    width: "100%"
  nav-item-current:
    backgroundColor: "rgb(var(--c-accent) / .09)"
    textColor: "{colors.accent}"
  chip-default:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  section-flat:
    textColor: "{colors.text}"
    padding: "25px 0 27px"
---
# Design System: novix.ai

## Overview

**Creative North Star: "编辑策划工作台"**

以用户已经确认的“编辑策划工作台”为北极星，让作品与故事材料处于连续稿面中。常驻作品目录承载导航与章节，主区先处理故事框架与场景，材料和检查按需展开。

本文件提取冻结实现中的颜色、字体、尺寸与组件，不为后续页面另造视觉体系。它记录当前代码，不能替代用户对新版审美的评价；独立实页评审和各尺寸检查的覆盖情况见本轮改动记录。

**Key Characteristics:**
- 冷纸白主稿面与雾灰目录层次。
- 深青用于主要动作、当前位置和焦点。
- 中文系统字体、平铺分区与可编辑作品标题。
- 目录、正文和材料面板按屏幕宽度切换。

来源：`frontend/src/index.css`、`frontend/tailwind.config.js`、`Layout.tsx`、`App.tsx` 与 `components/ui/`。产品事实见 [PRODUCT.md](PRODUCT.md)，本轮实际检查见 [14:04 改动记录](docs/changes/2026-11-13_14-04.md)。

## Colors

颜色的机器可读值以 frontmatter 为准，沿用源码 `--c-*` 的 RGB 色值。深色主题使用对应的 `*-dark` 项，应用仍由 `.dark` 覆盖 CSS 变量。

### Primary

- `accent` / `accent-hover`：深青主要动作、选中导航、焦点与强调；`on-accent` 为其文字。

### Neutral

- `panel`：冷纸白主稿面；`surface`：雾灰目录与材料区域；`surface-2`：轻度状态或辅助分层。
- `text` / `muted`：墨色正文与次级说明；`border`：分区和字段边界。

sidecar 的预览色阶由这些源值合成，仅供检查色阶；它们不新增应用颜色 token。

## Typography

中文界面沿用源码中的系统字体栈，无新增下载字体。作品标题、分区标题、普通文字与按钮的角色见 frontmatter；标签不使用装饰性全大写。

作品标题是可编辑输入，桌面使用 `story-title`，899px 以下为 27px、599px 以下为 26px。正文编辑器继承字号设置的 12/14/16px，行高为 2，最大行宽为 78ch；系统说明文字与表单维持各自的较密行高。

## Layout

工作区是全高 flex 布局。桌面作品目录宽 252px；主区可伸展，稿面宽度上限 1200px，常规内边距为纵向 42px、横向 52px。默认进入故事策划，中文主导航与章节目录共处侧栏。

故事总览使用主框架与重要场景预览两列，比例为 `minmax(0, 1.7fr)` 和 `minmax(230px, .8fr)`。1150px 以下总览改为单列，场景预览隐藏；同一内容仍可从“场景与情节”入口编辑。

899px 以下目录变为 264px 抽屉并默认收起，配有遮罩与关闭操作；材料检查面板从右侧展开。599px 以下表单网格改为单列，任务页签允许横向滚动。稿面内边距随断点减少；保留目录和材料面板的独立控制。

## Elevation & Depth

通用 Card 已实现为平铺的 `content-section`：依靠留白和分隔线分组，不带通用圆卡外框或外阴影。层次主要来自主稿面、目录和材料区的色调区别。

窄屏材料抽屉使用源码中的侧向阴影 `-10px 0 24px rgb(0 0 0 / .08)` 表示覆盖关系。Tailwind 配置仍保留旧的 `soft` 阴影供现有局部代码使用；它不构成当前通用分区的默认样式。

## Shapes

主要按钮、字段、导航和图标控件采用 6px 轻圆角。现有 `rounded-ui` 仍对应 0.6rem，状态标签为胶囊形；二者是保留的组件语言，不用于把整个稿面切成重复容器。

分区以 1px 边界和内容顺序组织。滚动条滑块使用 7px 圆角；焦点、文字选择和输入光标使用强调色。

## Components

### Buttons

主按钮为 `accent` 与 `on-accent`，次按钮为透明底与细边界，ghost 用于低强调动作。基础内边距和字体见 frontmatter，桌面最小高度为 36px、599px 以下为 38px。禁用态降低不透明度并显示不可操作光标。

颜色与边界变化使用 150ms 过渡；减少动态效果设置下移除按钮过渡。键盘焦点使用 2px 强调色轮廓，偏移 3px。

### Inputs / Fields

输入、选择与文本域共享 `form-control`：稿面底、细边界、6px 圆角及一致内边距。聚焦时边界改为强调色，增加低透明度轮廓；禁用态降低强调，文本域允许纵向调整高度。作品标题使用无外框的专用输入，下方边界响应悬停与焦点。

### Navigation

主导航为整行中文按钮，默认次级文字、悬停浅层底色，当前位置为低透明度强调色背景与较高字重。章节目录持续可见于侧栏内部；窄屏通过目录抽屉访问，搜索时保持展开，切换主导航后自动收起。图标使用已有 Lucide 线条，不以图标取代必要中文名称；仅图标按钮具备明确可访问名称。

### Chips

默认状态标签使用 `surface-2` 与 `muted`；已存在的成功和待处理状态继续使用对应语义样式。标签辅助内容，不承担首页主要构图。

### Cards / Containers

共享 Card 是带可选标题和操作区的 section，常规纵向内边距为上 25px、下 27px，标题与内容间隔 21px。局部复杂功能可能保留原有边框面板；新增普通内容优先复用平铺分区。

### Story workspace

作品名、故事概要、主要冲突和下一步场景共同构成策划稿面。材料与检查面板默认收起，通过顶栏打开；没有为工作区增加自动入场动画。

## Do's and Don'ts

### Do:
- **Do** 复用现有按钮、表单与平铺分区，让中文动作名称保持一致。
- **Do** 让导航、作品目录与当前位置清楚可辨，正文保持适合长文的行宽。
- **Do** 保留浅色与深色 token、可见焦点和减少动态效果的设置。
- **Do** 在实际桌面和窄屏检查真实内容；把未覆盖的视觉状态记入日志。

### Don't:
- **Don't** 将通用 Card 恢复成一组同等强调的圆角阴影卡片。
- **Don't** 用程序字段、工程路由或大段 JSON 代替作者日常操作。
- **Don't** 为本轮视觉调整删除功能、重置作者数据或重排已认可的设置表单。


### Chapter workspace

章节页沿用冷纸稿面与深青动作。章名是页面主标题，正文前的准备区只默认显示一段可选变化、一行场景展开入口、提前的润色工具与一份写法预览；不再用四步卡片或三份并列大文本框组织同一内容。材料与参考按需展开，来源和已选参考可以读、选或返回编辑，开发者技法JSON不占作者稿面。世界与地图在目录常驻，世界页提供地图/原创设定直达按钮。桌面和520px实际检查见17:04改动记录。

### 世界目录与上下文参考（19:21）

世界资料使用简介/重要设定总览、横向内容分类、200px目录与右侧编辑稿面；维护状态为目录筛选，六方向不重复列在目录。窄屏目录可折叠、内容为单列，分类自然换行。原三栏首页和新建类型网格样式已随布局更换移除，颜色和字体不变。

技法不占主导航。章节侧栏/标题和场景标题中的小入口打开420px上下文参考侧栏，沿用选项、说明、保存和具体落点。侧栏复用原文件内组件，以portal避免裁切；Escape可关闭并恢复入口焦点。桌面贴作品目录右缘，目录收起时贴窗口左缘，520px占满宽度；字段与正文编辑状态在父组件中保留。

### 资料填写与骨架起步（19:57）

沿用原色彩、字体、稿面和表单。世界简介中的可选短通则与人物卡自由文本字段各写各自内容，人物特殊关系才展开有方向的称呼，不新增必填规则表或字段AI按钮。工作表先呈现自由故事、已有结构整理/显式AI提取、可改序骨架与单列建议，再由作者确认到待保存原表；旧五表、矩阵和推演保留。写法参考以文学条目和一处展开说明为主，旧工具选择收进兼容区。本轮实页覆盖1280×720桌面；未新增窄屏或用户审美认可结论。

### 事件关系与世界基准（20:35）

保留既有视觉体系，当前故事使用中文入口、章节目录单行，作者页不展示只读JSON而保留底层数据。人物页就近查看入向/出向关系并回原人物原行编辑；事件时间线和图按原事件选择前后阶段、历史与伏笔，不要求先分章。多条同端点边用曲线分道、标签错开，完整标题保留在title/aria，选中边显示紧凑局部图且箭头位于节点外。世界现实参照/年代偏移按需展开，未选择不填默认年代；沿用原表单。最终桌面默认1702×1286实页无整页横向溢出，本轮未另验窄屏或取得新审美认可。


### 22:30 作者工作流增量

保留冷纸白、墨色与深青的 Operate 界面。作品设定先看世界 / 地点 / 人物总览 / 文风；人物资料进入后再编辑，主要联系仍用同源关系图。正文稿面放在章节首位，准备与技术记录默认收起，右栏跟随页面的资料范围。

情节工作表默认真实宽表、局部横向滚动；导入、骨架和事件线按需展开，列偏好保存在本机。逐格 AI 只在聚焦 / 悬停时出现，触屏保留可见操作。导入候选、来源、冲突处理与最新目标对照沿用同一套正文 / 属性表单，不用工程 JSON 代替作者编辑。保存状态、版本冲突和本地恢复在操作附近提示，禁止用旧模型结果覆盖新手稿。
