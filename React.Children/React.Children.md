# React.Children API 源码剖析

> 发布于 2021.11.13，最后更新于 2021.11.13。
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

## （三）`mapIntoArray()` 剖析

将源码定位到 `mapIntoArray()`，刚看到时我有点蒙，因为这家伙折叠起来一看，有 200+ 行。

**对于这种大函数，看源码我有个技巧**：

1. 先把函数体折叠起来，分析传参和 `return` 值，并猜一猜它的核心职责，以及要做什么处理；
2. 打开函数体，把 `if (__DEV__) {...}` 都折叠起来，这些大多是开发环境警告，与核心逻辑无关，可忽略；
3. 不要逐行去看，先一整段一整段地看，尤其关注像 `if`、`switch` 这种分支条件；
4. 分析完一整段代码后，给这段代码归纳出它的核心职责；
5. 必要时，可以在纸上画辅助图分析。

接下来，我就用以上这 5 步带大伙剖析 `mapIntoArray()` 函数。

### `mapIntoArray()` 的传参和 `return` 分析

我把传参和 `return` 贴出来：

```js
function mapIntoArray(
  children: ?ReactNodeList, // 要遍历的子节点树
  array: Array<React$Node>, // 遍历的结果数组
  escapedPrefix: string,
  nameSoFar: string,
  callback: (?React$Node) => ?ReactNodeList, // 给当前遍历节点调用的函数
): number { // 返回值是 map 得到的数组的元素数
  ...
}
```

结合着 [`Flow`](https://flow.org/) 静态类型检测工具，可以清晰看到传参和返回值的类型，这也是静态类型检测的优势，“**代码即文档**”。

不难猜到各参数的含义，我把它们注释出来了。`escapedPrefix`、`nameSoFar` 可能会猜不出，不过也没关系，猜不出的就先保留疑问。从命名 `prefix` 前缀、`name` 多少可以联想到这俩参数可能和字符串处理相关。它们是用于递归中命名 `key` 的，后文我们分析如何设置 `key` 时再关注它们。

需要重点注意的是**返回值是个数字**，它是本次调用 `mapIntoArray()` 过程中已遍历的子节点的计数，每次调用时将其累加，最终就能得到遍历的整个子节点树的节点数了。

让我们带着这些猜想进入到 `mapIntoArray()` 函数体中，我把 `if (__DEV__) {...}` 部分去掉了，我们一段一段地分析函数体。

### 判断 `children` 是否是单个子节点

`React.Children.map(children, function[(thisArg)])` 传入的待遍历 `children` 有可能是单个节点。源码一开始就对这种情况进行了判断：

```js
const type = typeof children;

if (type === 'undefined' || type === 'boolean') {
  // All of the above are perceived as null.
  // children 如果是 undefined 或 boolean，都被视为 null 去处理
  children = null;
}

let invokeCallback = false; // 是否直接用单个子节点调用 callback

// 如果 children 是 null | string | number 
// 或者是 $$typeof 属性是 REACT_ELEMENT_TYPE 或 REACT_PORTAL_TYPE 的对象
// 它们都是 React 可渲染的节点，那就将 invokeCallback 设为 true
if (children === null) {
  invokeCallback = true;
} else {
  switch (type) {
    case 'string':
    case 'number':
      invokeCallback = true;
      break;
    case 'object':
      switch ((children: any).$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          invokeCallback = true;
      }
  }
}
```

代码中，初始化了 `invokeCallback` 变量为 `false`，判断后如果它变为 `true`，就说明可以直接调用传入的 `callback` 函数。

从 `if`、`switch` 逻辑可以分析出，以下单个节点类型可以直接调 `callback`：

* `null`；
* `string`；
* `number`；
* `$$typeof` 属性是 `REACT_ELEMENT_TYPE` 或 `REACT_PORTAL_TYPE` 的对象。

它们都是 React 中可以有效渲染的节点类型。

另外 `REACT_ELEMENT_TYPE` 和 `REACT_PORTAL_TYPE` 这两个类型常量其实就是两个 `Symbol`：

```js
// 在 /shared/ReactSymbol.js 中
// ...
REACT_ELEMENT_TYPE = symbolFor('react.element');
REACT_PORTAL_TYPE = symbolFor('react.portal');
// ...
```

### 对单个子节点直接调用 `callback`

上一段对 `children` 类型进行判断后，如果是单节点，`invokeCallback` 就为 `true`，否则为 `false`。接着便是 `invokeCallback` 为 `true` 时的逻辑了：

```js
// 如果 invokeCallback 为 true，那就直接调用 callback
if (invokeCallback) {
  const child = children;
  let mappedChild = callback(child);
  // If it's the only child, treat the name as if it was wrapped in an array
  // so that it's consistent if the number of children grows:
  // 即便只有一个子节点，也会被当做包裹进一个数组中去命名。因为如果后续子节点的数量增加了，也能前后保持一致
  // 初始化子节点 key 的命名
  const childKey =
    nameSoFar === '' ? SEPARATOR + getElementKey(child, 0) : nameSoFar;
  if (isArray(mappedChild)) {
    // 如果调用 map 函数得到的子节点是数组，就编码好 key 前缀，然后递归进行 mapIntoArray()
    // 这一步确保了遍历的结果数组是一维的
    let escapedChildKey = '';
    if (childKey != null) {
      escapedChildKey = escapeUserProvidedKey(childKey) + '/';
    }
    mapIntoArray(mappedChild, array, escapedChildKey, '', c => c);
  } else if (mappedChild != null) {
    // 如果调用 map 函数得到的子节点不是数组，验证该节点是否是 ReactElement：
    //   A.对于 ReactElement，clone 它并附上新的 key，然后 push 进结果数组
    //   B.对于非 ReactElement，直接 push 进结果数组
    if (isValidElement(mappedChild)) {
      mappedChild = cloneAndReplaceKey(
        mappedChild,
        // Keep both the (mapped) and old keys if they differ, just as
        // traverseAllChildren used to do for objects as children
        // 如果 map 前后节点的 key 不同，那么都将保留
        // 用之前递归过程中的 key 前缀拼接本次 map 的节点的 key
        escapedPrefix +
          // $FlowFixMe Flow incorrectly thinks React.Portal doesn't have a key
          // $FlowFixMe Flow 错误的认为 React.Portal 没有 key
          // 这里三目判断条件是：是否是 “map 后的 child 有 key，且与 map 前不同”
          (mappedChild.key && (!child || child.key !== mappedChild.key)
            ? // $FlowFixMe Flow incorrectly thinks existing element's key can be a number
              // $FlowFixMe Flow 错误地认为元素的 key 可以是数字
              // eslint-disable-next-line react-internal/safe-string-coercion
              escapeUserProvidedKey('' + mappedChild.key) + '/'
            : '') +
          childKey,
      );
    }
    array.push(mappedChild);
  }
  return 1;
}
```

代码中，判断如果 `invokeCallback` 为 `true`，那么通过 `let mappedChild = callback(child);` 对单个子节点直接调用了 `callback`，得到 `map` 后的返回值 `mappedChild`。

得到的 `mappedChild` 主要有两种情况：

* 是个数组；
* 不是 `null` 也不是数组：
  * 是单个有效的 ReactElement 对象；
  * 是单个其它值。

为什么调用 `callback` 后可能得到数组呢？还记得我们一开始的编码示例么：

```js
const playedChildren = React.Children.map(props.children, (c) => [c, [c, c]]);
```

这里的 `map` 函数是 `(c) => [c, [c, c]]`，我们 `return` 了一个嵌套数组，这个函数会在 `callback` 中调用。所以 `mappedChild` 是数组对应的就是这种情况。

我们先忽略处理 `key` 的逻辑，只关注主体逻辑。

如果 `mappedChild` 是数组，那么：

```js
mapIntoArray(mappedChild, array, escapedChildKey, '', c => c);
```

**`mappedChild` 是数组的情况下，会递归地调用 `mapIntoArray()` 自身**，透传了 `array` 这个整个 `map` 遍历的结果数组，另外将再次调用 `mapIntoArray()` 的 `callback` 固定成了 `c => c`，也就是返回自己。这是因为如果再去返回一个什么数组，那就会无限递归下去了...

#### `isValidElement()` 验证是否是 `ReactElement` 对象

接着，如果 `mappedChild` 不是 `null` 也不是数组，那么会通过 `isValidElement()` 来验证它是否是 `ReactElement` 对象。

我们来看看 `isValidElement()` 函数，看看 React 是如何判断节点类型的，其实很简单：

```js
// 在 /react/src/ReactElement.js 中

/**
 * Verifies the object is a ReactElement.
 * 判断传入的对象是否是 ReactElement
 * See https://reactjs.org/docs/react-api.html#isvalidelement
 * @param {?object} object
 * @return {boolean} True if `object` is a ReactElement.
 * @final
 */
export function isValidElement(object) {
  // 主要通过对象的 $$typeof 属性是否是 REACT_ELEMENT_TYPE 来判断
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE
  );
}
```

可以发现，**React 主要是通过对象上的 `$$typeof` 属性来判断节点类型的**。如果 `$$typeof` 属性是 `REACT_ELEMENT_TYPE` 这个 `Symbol`，那么该对象就是一个 `ReactElement`。

#### `cloneAndReplaceKey` 克隆节点并附上新 `key`

如果验证的是一个 `ReactElement`，那么通过 `cloneAndReplaceKey()` 克隆它并设置上新的 `key`，最后 `push` 进结果数组 `array` 中：

```js
if (isValidElement(mappedChild)) {
  mappedChild = cloneAndReplaceKey(
    mappedChild,
    escapedPrefix +
      (mappedChild.key && (!child || child.key !== mappedChild.key)
        ? escapeUserProvidedKey('' + mappedChild.key) + '/'
        : '') +
      childKey,
  );
}
array.push(mappedChild);
```

`cloneAndReplaceKey()` 函数也很简单：

```js
// 在 /react/src/ReactElement.js 中
const ReactElement = function(type, key, ref, self, source, owner, props) {
  const element = {
    $$typeof: REACT_ELEMENT_TYPE,
    type: type,
    key: key,
    ref: ref,
    props: props,
    _owner: owner,
  };
  return element;
};
// ...
// clone 一个 ReactElement 并附上新的 key
export function cloneAndReplaceKey(oldElement, newKey) {
  const newElement = ReactElement(
    oldElement.type,
    newKey,
    oldElement.ref,
    oldElement._self,
    oldElement._source,
    oldElement._owner,
    oldElement.props,
  );
  return newElement;
}
```

可以发现，它只是把原有 `ReactElement` 对象的属性加到新对象中，`return` 新对象，另外使用了新的 `newKey`。

这就是 `if (invokeCallback) {...}` 这个条件分支做的主要的事情了，判断 `mappedChild` 是否是数组这两种情况并分别做处理。

最后别忘了，该条件分支结尾 `return 1`。为什么要 `return 1`？因为前面我们说 `mapIntoArray()` 是要返回已遍历的节点数的，这里 `invokeCallback` 为 `true` 仅遍历了一个节点，所以 `return 1`。

至此，`map` 单节点的逻辑就完整了 :)
