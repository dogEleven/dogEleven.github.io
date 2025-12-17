# 项目框架介绍 (Project Framework Overview)

本项目是一个基于 WebGL (Three.js) 的 3D 星球探索游戏/演示。项目主要包含以下几个核心模块和文件夹结构。

## 1. 目录结构

*   **根目录** (`d:\GitProject\dogEleven.github.io\`)
    *   `planet.html/`: 核心游戏逻辑目录。
        *   `index.html`: **主程序文件**。包含了所有的游戏逻辑、渲染代码、着色器 (Shaders) 和 HTML 结构。这是一个单文件项目 (Single File Component) 风格的实现。
    *   `planetsoc/`: 可能包含项目的旧版本或社交功能变体。
    *   `index.html/`: 网站入口或其他相关页面资源。
    *   `.agent/`: AI 助手的工作流和配置文件。

## 2. 技术栈

*   **核心引擎**: [Three.js (r128)](https://threejs.org/) - 用于 3D 场景及其对象的渲染。
*   **语言**: 原生 HTML5, CSS3, JavaScript (ES6+)。无构建工具依赖，可直接在浏览器运行。
*   **着色器**: GLSL (在 JS 中以字符串形式编写)，用于自定义星球地形、材质和植被渲染。

## 3. 核心功能模块 (`planet.html/index.html`)

该文件集成了游戏的所有主要子系统：

### A. 渲染与环境 (Rendering & Environment)
*   **场景设置**: 使用 `THREE.Scene`, `THREE.PerspectiveCamera`, `THREE.WebGLRenderer`。
*   **背景**: CSS 渐变背景 (深空蓝)，配合 Three.js 的透明 Canvas。
*   **后期处理 (Post-Processing)**: 引入了 `EffectComposer`, `BokehPass` (景深效果)，虽然代码中目前包含但可能被暂时注释或禁用。

### B. 程序化星球生成 (Procedural Planet Generation)
*   **几何体**: 基于 `THREE.SphereGeometry` (128x128 分段) 进行大量细分。
*   **噪声算法 (Noise)**: 内置了单纯形噪声 (Simplex-like Noise) 算法 (`perm` 数组, `noise` 函数)，用于生成随机地形。
*   **地形重塑**:
    *   **CPU 端**: 在 JS 中直接修改顶点位置，根据噪声生成山脉、平原。
    *   **道路系统**: 通过计算顶点与“赤道”的距离，程序化地压平地形生成环绕星球的道路。
    *   **GPU 端 (Shader)**: 自定义 `ShaderMaterial`，根据高度 (`vPosition`) 动态混合颜色（深水、沙滩、草地、森林、岩石、雪顶）。
    *   **道路渲染**: 在 Fragment Shader 中通过距离计算动态绘制路面和白色虚线。

### C. 植被与装饰系统 (Vegetation & Decoration)
*   **实例化渲染 (Instanced Rendering)**:
    *   **草地**: 使用 `THREE.InstancedBufferGeometry` 渲染 80,000+ 棵草。具有风吹摆动 (Wind Sway) 和玩家互动 (Bend away from player) 的 Shader 效果。
    *   **物品**: 石头、树枝、蘑菇等均通过 Instance 批量渲染，保证高性能。
*   **树木生成**: 程序化生成的球形树冠，带有 "毛茸茸" 的树叶效果（也是通过 Shader 实现）。

### D. 物理与控制系统 (Physics & Controls)
*   **自定义物理引擎**:
    *   不依赖第三方物理库，使用简单的向量数学实现。
    *   **球体物理**: 模拟重力指向星球中心。
    *   **碰撞检测**: 使用 `THREE.Raycaster` 从高空向下投射，检测地形高度，实现贴地行走。
    *   **跳跃与重力**: 简单的 `vSpeed` 垂直速度模拟。
    *   **水下逻辑**: 进入水面以下会有浮力和阻力效果。
*   **玩家控制**:
    *   **键盘**: W/A/S/D 移动，空格跳跃。
    *   **移动端**: 检测触摸事件，通过虚拟摇杆 (Virtual Joystick) 控制移动。
*   **相机跟随**: 定义了稳定的 "Up" 向量和插值逻辑，使相机平滑跟随玩家及其在球体表面的旋转。

### E. 游戏性功能 (Gameplay Features)
*   **物品系统**:
    *   玩家可以拾取地面上的物品（石头、树枝、蘑菇）。
    *   **拾取/丢弃**: 拾取物品有视觉反馈（物品吸附到玩家手上）。
*   **宝箱与库存**:
    *   有一个宝箱对象，当玩家持有物品靠近时，物品会被自动存放进宝箱。
    *   **UI**: 宝箱上方有浮动的 HTML UI 显示库存数量。
*   **NPC/跟随者系统 (Followers)**:
    *   随机生成的小人。
    *   **AI 行为**: 具有简单的状态机（游荡、发现玩家、跟随、群集分离）。
    *   **交互**: 靠近玩家后会 "加入队伍" 并跟随。


### F. 实体分类与架构 (Entity Classification)

游戏中的实体根据行为和渲染方式可分为以下几类：

1.  **动态实体 (Dynamic Entities)**:
    *   **玩家 (Player)**:
        *   由 `THREE.Group` 组合而成（头、身体、四肢）。
        *   具有物理属性（速度、位置、朝向）。
        *   由 `Input` (键盘/触摸) 直接驱动。
    *   **跟随者 (Followers)**:
        *   程序化生成的小人（简化版的玩家模型）。
        *   **AI 逻辑**: 包含状态机 (Idle, Chasing, Jumping)。
        *   **物理**: 具有独立的碰撞体积和重力模拟。
        *   **同步**: 能够响应全局事件（如玩家跳跃）。

2.  **交互式静态实体 (Interactive Static Entities)**:
    *   **宝箱 (Chest)**:
        *   核心交互点。包含存储逻辑和 UI 显示。
        *   **功能**: 检测玩家距离，自动收集物品，显示库存气泡。
    *   **可拾取物品 (Collectibles)**:
        *   **类型**: 石头 (Stone), 树枝 (Twig), 蘑菇 (Mushroom)。
        *   **渲染**: 使用 `THREE.InstancedMesh` 渲染成百上千个实例。
        *   **逻辑**: 通过距离检测模拟拾取，通过修改 Instance 的 Scale (缩放为0) 来实现“消失”。

3.  **环境实体 (Environmental Entities)**:
    *   **星球 (Planet)**: 核心地形 Mesh，带有 CPU 变形和自定义 Shader。
    *   **水体 (Water)**: 独立的半透明球体，模拟海洋。
    *   **植被 (Vegetation)**:
        *   **草 (Grass)**: 大规模实例化渲染，Shader 驱动风效。
        *   **树木 (Trees)**: 程序化生成的静态对象。
    *   **天体 (Celestial)**: 星空背景 (Points) 和光源 (Sun/Ambient)。

## 4. 代码特点

*   **无依赖**: 单个 HTML 文件即可运行，极大简化了部署。
*   **混合渲染**: 巧妙结合了 WebGL (3D场景) 和 DOM (UI, 背景)。
*   **数学密集**: 大量使用向量运算 (`THREE.Vector3`, `Quaternion`) 处理球体表面的坐标变换和旋转。

---
*文档生成时间: 2025-12-18*
