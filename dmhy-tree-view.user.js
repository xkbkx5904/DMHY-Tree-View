// ==UserScript==
// @name         动漫花园树状显示
// @name:zh-CN   动漫花园树状显示
// @name:en      DMHY Tree View
// @namespace    https://github.com/xkbkx5904/dmhy-tree-view
// @version      0.4.0
// @description  将动漫花园的文件列表转换为树状视图，支持搜索、智能展开等功能
// @description:zh-CN  将动漫花园的文件列表转换为树状视图，支持搜索、智能展开等功能
// @description:en  Convert DMHY file list into a tree view with search and smart collapse features
// @author       xkbkx5904
// @license      GPL-3.0
// @homepage     https://github.com/xkbkx5904/dmhy-tree-view
// @supportURL   https://github.com/xkbkx5904/dmhy-tree-view/issues
// @match        *://share.dmhy.org/topics/view/*
// @require      https://cdn.jsdelivr.net/npm/jquery@3.5.1/dist/jquery.min.js
// @require      https://cdn.jsdelivr.net/npm/jstree@3.3.11/dist/jstree.min.js
// @resource     customCSS https://cdn.jsdelivr.net/npm/jstree@3.3.11/dist/themes/default/style.min.css
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @run-at       document-end
// @originalAuthor TautCony
// @originalURL  https://greasyfork.org/zh-CN/scripts/26430-dmhy-tree-view
// ==/UserScript==

// 文件类型图标映射
const ICONS = {
    audio: "/images/icon/mp3.gif",
    bmp: "/images/icon/bmp.gif",
    image: "/images/icon/jpg.gif",
    png: "/images/icon/png.gif",
    rar: "/images/icon/rar.gif",
    text: "/images/icon/txt.gif",
    unknown: "/images/icon/unknown.gif",
    video: "/images/icon/mp4.gif"
};

// 文件扩展名分类
const FILE_TYPES = {
    audio: ["flac", "aac", "wav", "mp3", "m4a", "mka"],
    bmp: ["bmp"],
    image: ["jpg", "jpeg", "webp"],
    png: ["png", "gif"],
    rar: ["rar", "zip", "7z", "tar", "gz"],
    text: ["txt", "log", "cue", "ass", "ssa", "srt", "doc", "docx", "xls", "xlsx", "pdf"],
    video: ["mkv", "mp4", "avi", "wmv", "flv", "m2ts"]
};

// 设置样式
const setupCSS = () => {
    GM_addStyle(GM_getResourceText("customCSS"));
    GM_addStyle(`
        .jstree-node, .jstree-default .jstree-icon {
            background-image: url(https://cdn.jsdelivr.net/npm/jstree@3.3.11/dist/themes/default/32px.png);
        }

        .tree-container {
            background: #fff;
            border: 2px solid;
            border-color: #404040 #dfdfdf #dfdfdf #404040;
            padding: 5px;
        }

        .control-panel {
            background: #f0f0f0;
            border-bottom: 1px solid #ccc;
            padding: 5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .control-panel-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .control-panel-right {
            margin-left: auto;
            display: flex;
            align-items: center;
        }

        #search_input {
            border: 1px solid #ccc;
            padding: 2px 5px;
            width: 200px;
        }

        #switch {
            padding: 2px 5px;
            cursor: pointer;
        }

        #file_tree {
            padding: 5px;
            max-height: 600px;
            overflow: auto;
        }

        .filesize {
            padding-left: 8px;
            color: #666;
        }

        .smart-toggle {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;
        }

        .smart-toggle input {
            margin: 0;
        }
    `);
};

// 树节点基础类
class TreeNode {
    constructor(name) {
        this.name = name;
        this.length = 0;
        this.childNode = new Map();
        this._cache = new Map();
    }

    // 插入节点
    insert(path, size) {
        let currentNode = this;
        for (const node of path) {
            if (!currentNode.childNode.has(node)) {
                currentNode.childNode.set(node, new TreeNode(node));
            }
            currentNode = currentNode.childNode.get(node);
        }
        currentNode.length = this.toLength(size);
        return currentNode;
    }

    // 转换为显示文本
    toString() {
        const size = this.childNode.size > 0 ? this.calculateTotalSize() : this.length;
        return `<span class="filename">${this.name}</span><span class="filesize">${this.toSize(size)}</span>`;
    }

    // 计算总大小
    calculateTotalSize() {
        if (this._cache.has('totalSize')) return this._cache.get('totalSize');

        let total = this.length;
        for (const node of this.childNode.values()) {
            total += node.childNode.size === 0 ? node.length : node.calculateTotalSize();
        }

        this._cache.set('totalSize', total);
        return total;
    }

    // 转换为jstree对象
    toObject() {
        if (this._cache.has('object')) return this._cache.get('object');

        const ret = {
            text: this.toString(),
            children: [],
            state: { opened: false }
        };

        // 分别处理文件夹和文件
        const folders = [];
        const files = [];

        for (const [, value] of this.childNode) {
            if (value.childNode.size === 0) {
                files.push({
                    icon: value.icon,
                    length: value.length,
                    text: value.toString()
                });
            } else {
                const inner = value.toObject();
                folders.push({
                    ...inner,
                    text: `<span class="filename">${value.name}</span><span class="filesize">${this.toSize(value.calculateTotalSize())}</span>`,
                    state: { opened: false }
                });
            }
        }

        ret.children = [...folders, ...files];
        this._cache.set('object', ret);
        return ret;
    }

    // 获取文件扩展名
    get ext() {
        if (this._ext !== undefined) return this._ext;
        const dotIndex = this.name.lastIndexOf(".");
        this._ext = dotIndex > 0 ? this.name.substr(dotIndex + 1).toLowerCase() : "";
        return this._ext;
    }

    // 获取文件图标
    get icon() {
        if (this._icon !== undefined) return this._icon;
        this._icon = ICONS.unknown;
        for (const [type, extensions] of Object.entries(FILE_TYPES)) {
            if (extensions.includes(this.ext)) {
                this._icon = ICONS[type];
                break;
            }
        }
        return this._icon;
    }

    // 转换文件大小字符串为字节数
    toLength(size) {
        if (!size) return -1;
        const match = size.toLowerCase().match(/^([\d.]+)\s*([kmgt]?b(?:ytes)?)$/);
        if (!match) return -1;
        const [, value, unit] = match;
        const factors = { b: 0, bytes: 0, kb: 10, mb: 20, gb: 30, tb: 40 };
        return parseFloat(value) * Math.pow(2, factors[unit] || 0);
    }

    // 转换字节数为可读大小
    toSize(length) {
        if (length < 0) return "";
        const units = [[40, "TiB"], [30, "GiB"], [20, "MiB"], [10, "KiB"], [0, "Bytes"]];
        for (const [factor, unit] of units) {
            if (length >= Math.pow(2, factor)) {
                return (length / Math.pow(2, factor)).toFixed(unit === "Bytes" ? 0 : 3) + unit;
            }
        }
        return "0 Bytes";
    }
}

// 查找树中第一个分叉节点
function findFirstForkNode(tree) {
    const findForkInNode = (nodeId) => {
        const node = tree.get_node(nodeId);
        if (!node || !node.children) return null;
        if (node.children.length > 1) return node;
        if (node.children.length === 1) return findForkInNode(node.children[0]);
        return null;
    };
    return findForkInNode('#');
}

// 获取到指定节点的路径
function getPathToNode(tree, targetNode) {
    const path = [];
    let currentNode = targetNode;
    while (currentNode.id !== '#') {
        path.unshift(currentNode.id);
        currentNode = tree.get_node(tree.get_parent(currentNode));
    }
    return path;
}

// 获取第一个分叉点及其路径信息
function getFirstForkInfo(tree) {
    const firstFork = findFirstForkNode(tree);
    if (!firstFork) return null;
    
    const pathToFork = getPathToNode(tree, firstFork);
    const protectedNodes = new Set(pathToFork);
    protectedNodes.add(firstFork.id);
    
    return {
        fork: firstFork,
        pathToFork,
        protectedNodes
    };
}

// 智能折叠：只折叠分叉点以下的节点
function smartCollapse(tree) {
    const forkInfo = getFirstForkInfo(tree);
    if (!forkInfo) return;

    // 获取所有打开的节点
    const openNodes = tree.get_json('#', { flat: true })
        .filter(node => tree.is_open(node.id))
        .map(node => node.id);
    
    // 只折叠不在保护名单中的节点
    openNodes.forEach(nodeId => {
        if (!forkInfo.protectedNodes.has(nodeId)) {
            tree.close_node(nodeId);
        }
    });
}

// 主程序入口
(() => {
    // 设置样式
    setupCSS();

    // 创建树数据
    const data = new TreeNode($(".topic-title > h3").text());
    const pattern = /^(.+?) (\d+(?:\.\d+)?[TGMK]?B(?:ytes)?)$/;

    // 解析文件列表
    $(".file_list:first > ul li").each(function() {
        const text = $(this).text().trim();
        const line = text.replace(/\t+/i, "\t").split("\t");

        if (line.length === 2) {
            data.insert(line[0].split("/"), line[1]);
        } else if (line.length === 1) {
            const match = pattern.exec(text);
            if (match) {
                data.insert(match[1].split("/"), match[2]);
            } else {
                data.insert(line[0].split("/"), "");
            }
        }
    });

    // 创建UI
    const fragment = document.createDocumentFragment();
    const treeContainer = $('<div class="tree-container"></div>').appendTo(fragment);
    
    const controlPanel = $('<div class="control-panel"></div>')
        .append($('<div class="control-panel-left"></div>')
            .append('<input type="text" id="search_input" placeholder="搜索文件..." />')
            .append('<button id="switch">展开全部</button>')
        )
        .append($('<div class="control-panel-right"></div>')
            .append('<label class="smart-toggle"><input type="checkbox" id="smart_mode" />智能展开</label>')
        )
        .appendTo(treeContainer);
    
    const fileTree = $('<div id="file_tree"></div>').appendTo(treeContainer);
    $('.file_list:first').replaceWith(fragment);

    // 创建树实例
    const treeInstance = fileTree.jstree({
        core: { 
            data: data.toObject(),
            themes: { variant: "large" }
        },
        plugins: ["search", "wholerow", "contextmenu"],
        contextmenu: {
            select_node: false,
            show_at_node: false,
            items: {
                getText: {
                    label: "复制",
                    action: selected => {
                        const text = selected.reference.find(".filename").text();
                        navigator.clipboard.writeText(text);
                    }
                }
            }
        }
    });

    // 绑定事件
    treeInstance.on("ready.jstree", function() {
        const tree = treeInstance.jstree(true);
        const isSmartMode = localStorage.getItem('dmhy_smart_mode') !== 'false';
        
        if (isSmartMode) {
            const firstFork = findFirstForkNode(tree);
            if (firstFork) {
                const pathToFork = getPathToNode(tree, firstFork);
                pathToFork.forEach(nodeId => tree.open_node(nodeId));
            }
        }
    });

    treeInstance.on("loaded.jstree", function() {
        const tree = treeInstance.jstree(true);
        let isExpanded = false;
        let isSmartMode = localStorage.getItem('dmhy_smart_mode') !== 'false';
        let previousState = null;
        let hasSearched = false;
        
        // 更新展开/折叠按钮状态
        const updateSwitchButton = () => {
            $("#switch").text(isExpanded ? "折叠全部" : "展开全部");
        };

        // 绑定展开/折叠按钮事件
        $("#switch").click(function() {
            isExpanded = !isExpanded;
            
            if (isSmartMode) {
                if (isExpanded) {
                    tree.open_all();
                } else {
                    smartCollapse(tree);  // 使用新的智能折叠函数
                }
            } else {
                if (isExpanded) {
                    tree.open_all();
                } else {
                    tree.close_all();
                }
            }
            
            updateSwitchButton();
        });

        // 绑定智能模式切换事件
        $("#smart_mode").prop('checked', isSmartMode).change(function() {
            isSmartMode = this.checked;
            localStorage.setItem('dmhy_smart_mode', isSmartMode);
            
            isExpanded = false;
            localStorage.setItem('dmhy_tree_expanded', isExpanded);
            
            if (isSmartMode) {
                tree.close_all();
                const firstFork = findFirstForkNode(tree);
                if (firstFork) {
                    const pathToFork = getPathToNode(tree, firstFork);
                    pathToFork.forEach(nodeId => tree.open_node(nodeId));
                }
            } else {
                tree.close_all();
            }
            
            updateSwitchButton();
        });

        // 绑定搜索事件
        const searchDebounceTime = 250;
        let treeNodes = null;  // 缓存所有节点

        // 初始化时缓存所有节点
        treeNodes = tree.get_json('#', { flat: true });

        $('#search_input').keyup(function() {
            if(searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const searchText = $('#search_input').val().toLowerCase();
                
                if (searchText) {
                    if (!hasSearched) {
                        // 仅在第一次搜索时保存状态
                        previousState = {
                            isExpanded,
                            openNodes: treeNodes.filter(node => tree.is_open(node.id))
                                .map(node => node.id)
                        };
                        hasSearched = true;
                    }
                    
                    // 使用缓存的节点数据进行过滤
                    const matchedNodes = new Set();
                    treeNodes.forEach(node => {
                        const nodeText = tree.get_text(node.id).toLowerCase();
                        if (nodeText.includes(searchText)) {
                            matchedNodes.add(node.id);
                            // 一次性获取所有父节点
                            let parent = tree.get_parent(node.id);
                            while (parent !== '#') {
                                matchedNodes.add(parent);
                                parent = tree.get_parent(parent);
                            }
                        }
                    });

                    // 批量处理节点显示/隐藏
                    const operations = [];
                    treeNodes.forEach(node => {
                        if (matchedNodes.has(node.id)) {
                            operations.push(() => {
                                tree.show_node(node.id);
                                tree.open_node(node.id);
                            });
                        } else {
                            operations.push(() => tree.hide_node(node.id));
                        }
                    });

                    // 使用 requestAnimationFrame 分批执行操作
                    const batchSize = 50;
                    const executeBatch = (startIndex) => {
                        const endIndex = Math.min(startIndex + batchSize, operations.length);
                        for (let i = startIndex; i < endIndex; i++) {
                            operations[i]();
                        }
                        if (endIndex < operations.length) {
                            requestAnimationFrame(() => executeBatch(endIndex));
                        }
                    };
                    executeBatch(0);
                    
                    isExpanded = true;
                } else {
                    // 还原状态
                    if (previousState) {
                        tree.show_all();
                        tree.close_all();
                        // 批量还原打开的节点
                        const restoreNodes = () => {
                            const batch = previousState.openNodes.splice(0, 50);
                            batch.forEach(nodeId => tree.open_node(nodeId, false));
                            if (previousState.openNodes.length > 0) {
                                requestAnimationFrame(restoreNodes);
                            }
                        };
                        restoreNodes();
                        
                        isExpanded = previousState.isExpanded;
                        previousState = null;
                        hasSearched = false;
                    }
                }
                
                updateSwitchButton();
            }, searchDebounceTime);
        });
    });
})();
