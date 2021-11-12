# React.Children API 源码剖析

> 发布于 2021.11.12，最后更新于 2021.11.12。
>
> 源码版本：V17.0.3

React 中，可以通过 `props.children` 来获取当前组件的子节点。偶尔会遇到要**自定义处理子节点**的情况，这就要用到 [`React.Children`](https://reactjs.org/docs/react-api.html#reactchildren) 相关 API 了。

`React.Children` 目前提供了 5 个 API，分别是：

* [`React.Children.map(children, function[(thisArg)])`](https://reactjs.org/docs/react-api.html#reactchildrenmap)：类似数组的 `map` 方法，遍历 `children` 的每个直接子节点，调用传入的函数，最终得到一个新数组；
* [`React.Children.forEach(children, function[(thisArg)])`](https://reactjs.org/docs/react-api.html#reactchildrenforeach)：类似数组的 `forEach` 方法，与 `React.Children.map()` 类似，只是没有返回值；
* [`React.Children.count(children)`](https://reactjs.org/docs/react-api.html#reactchildrencount)：得到 `children` 中子节点（也包括子节点的子节点们，也就是子节点树）的总数量；
* [`React.Children.only(children)`](https://reactjs.org/docs/react-api.html#reactchildrenonly)：验证 `children` 是否只有 1 个子节点，是的话就返回这个节点，不是的话抛错；
* [`React.Children.toArray(children)`](https://reactjs.org/docs/react-api.html#reactchildrentoarray)：将 `children` 展开为一维数组并返回。

本文会对它们的源码进行剖析，除此之外，过程中还能学到：

* 如何用**双层递归**来展开节点子树；
* 节点的 `key` 是如何设置的；
* 如何用 36 进制数优化 `key` 的字符数（这是**多进制数**在编程中的一个常见场景）；

在 [这次 Commit]() 中，我对 `React.Children` API 的源码做了详细的逐行注释，供大家参考 :)

## （一）用 `React.Children.map()` 将子节点树“铺平”

几个 API 中最核心的就是 `React.Children.map()` 了，后文我们会发现，其实其他 API 的源码实现中，就是调用了它。所以搞懂了它，其他的也就小 Case 了。

我写了一个 [使用 `React.Children.map()` 的简单示例](https://codesandbox.io/s/react-children-map-usage-mgno5)，你也可以在 [这里](https://github.com/roc-an/react-wisdom/tree/main/React.Children/examples/react-children-map-usage) 找到示例代码。

示例代码 `/src/ReactChildrenMapUsage.js`：

```js
import React from "react";

function PlayChildren(props) {
  // 观察渲染后的 DOM 结构可以发现，这里 React.Children.map() 将得到的子节点展开成一维数组（无论怎么嵌套）。
  // 也就是 [c, [c, c]] 将展开成 [c, c, c]
  const playedChildren = React.Children.map(props.children, (c) => [c, [c, c]]);
  console.log(
    "通过 React.Children.map() 遍历 PlayChildren 子节点，得到新的一维子节点数组",
    playedChildren
  );

  return playedChildren;
}

const ReactChildrenMapUsage = () => (
  <PlayChildren>
    <span>A</span>
    <span>B</span>
  </PlayChildren>
);

export default ReactChildrenMapUsage;
```

代码中，`<PlayChildren>` 组件有两个直接字节点 `<span>` A 和 B。

在 `PlayChildren` 组件中，我们用 `React.Children.map()` 去遍历它们（`props.children`）。注意，遍历用的 `map` 函数是：`(c) => [c, [c, c]]`。

虽然这里用了嵌套数组，但观察渲染出来的 DOM 结构：

```html
<div id="root">
  <span>A</span>
  <span>A</span>
  <span>A</span>
  <span>B</span>
  <span>B</span>
  <span>B</span>
</div>
```

你会发现，渲染出来的 DOM 结构是扁平的，不存在什么 `<span>` 嵌套 `<span>` 的情况。

**这是 `React.Children.map()` 一个很关键的点，用它进行 `map` 遍历后，永远得到的是一个展开了的一维数组，无论你的 `map` 函数如何嵌套 `return` 的节点结构**。如果想要将组件的子节点重新排序，或者很方便地获取子节点树的叶子节点们，这个方法非常实用。

## （二）一探 `React.Children.map()` 源码

接下来，让我们一探 `React.Children` API 的源码，它们在 `react` 这个模块中。

沿着入口找，不难发现，它们都在 [`ReactChildren.js`](https://github.com/roc-an/react-wisdom-codebase/blob/main/packages/react/src/ReactChildren.js) 这个文件中。

这个文件的 `export` 就是 `React.Children` 的 5 个 API：

```js
export {
  forEachChildren as forEach,
  mapChildren as map,
  countChildren as count,
  onlyChild as only,
  toArray,
};
```

我们重点分析 `mapChildren` 函数，搞懂了它，其他 API 秒懂。

`mapChildren` 函数源码：

```js
/**
 * Maps children that are typically specified as `props.children`.
 * Map 遍历那些被指定为 `props.children` 的子节点
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenmap
 *
 * The provided mapFunction(child, index) will be called for each
 * leaf child.
 * 会为每个叶子节点调用传入的 mapFunction(child, index)
 *
 * @param {?*} children Children tree container. // 子节点树
 * @param {function(*, int)} func The map function. // map 遍历函数
 * @param {*} context Context for mapFunction. // map 遍历函数的上下文
 * @return {object} Object containing the ordered map of results. // 包含着排序后的 map 结果的对象
 */
function mapChildren(
  children: ?ReactNodeList,
  func: MapFunc,
  context: mixed,
): ?Array<React$Node> {
  // 如果传入的子节点容器是 null，就直接 return
  if (children == null) {
    return children;
  }
  // 初始化 map 结果数组和计数变量
  const result = [];
  let count = 0;

  mapIntoArray(children, result, '', '', function(child) {
    // 用指定上下文（没传就是 undefined）调用传入的 func（就是 map 遍历函数）并计数
    return func.call(context, child, count++);
  });
  return result;
}
```

`mapChildren` 中只是对传入的 `children` 做简单的判 `null` 处理，并且初始化了用于承载 `map` 结果的数组 `result`，以及用来统计已遍历的子节点（包括子节点的子节点们，也就是子节点树）数 `count`，最后 `return` 结果数组。

它里面最核心的，猜也能猜到，就是调用了 `mapIntoArray()` 函数，`mapChildren()` 将应用层传入的 `children`、`func` 以及自己构建的 `result` 和 `count` 都透传进了 `mapIntoArray()`。
