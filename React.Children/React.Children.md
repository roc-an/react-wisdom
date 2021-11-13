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
* `Iterator` 可迭代对象的使用。

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

### 对多节点进行 `map`

接下来就是处理 `children` 是多节点的情况了。其实理解了上面处理单节点，处理多节点就简单很多了。因为**即便有再多的节点，最终还是要变成处理单节点，从而整个大递归就完成了闭环**。

多节点的代码我们分段来看，因为源码中把 `children` 多节点分成了两种情况：

```js
// 如果 invokeCallback 为 false，也就是 children 不是单个节点，那么对其进行遍历
let child; // 用于存当前遍历的子节点
let nextName;
// Count of children found in the current subtree.
// 当前子节点树的节点数
let subtreeCount = 0;
const nextNamePrefix =
  nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;

if (isArray(children)) {
  // ...
} else {
  const iteratorFn = getIteratorFn(children);
  if (typeof iteratorFn === 'function') {
    // ...
  } else if (type === 'object') {
    // ...
  }
}

return subtreeCount;
```

观察条件分支，`children` 多节点有两种主要情况：

* 是个数组；
* 可能是一个可迭代对象：
  * 部署了 `Iterator` 接口，也就是对象上有 `iteratorFn` 函数；
  * `type === 'object'` 但又没有 `Iterator` 接口，也就是无法迭代，这种情况就报错。

**有了 ES6 Iterator 后，咱们意识里不能一提可遍历，那数据一定是个数组，也有可能是个部署了 `Iterator` 接口的对象，这点很重要**。

`Iterator` 的使用不是本文重点，如果你对它概念上有些模糊，我推荐看朊老师的 [`Iterator` 和 `for...of` 循环 |《ECMAScript 6 入门》](https://es6.ruanyifeng.com/#docs/iterator)，里面有详尽的用例。不过即便对 `Iterator` 不熟，也不影响我们阅读这块源码，只需要知道对象也可能是可迭代遍历的就好。

接下来就深入到这两种情况中一探究竟，都比较简单。

#### `children` 是数组的情况

上菜（代码）：

```js
if (isArray(children)) {
  // 如果 children 是数组，遍历这个数组，并用子节点递归地调用 mapIntoArray()
  for (let i = 0; i < children.length; i++) {
    child = children[i];
    nextName = nextNamePrefix + getElementKey(child, i);
    subtreeCount += mapIntoArray(
      child,
      array,
      escapedPrefix,
      nextName,
      callback,
    );
  }
} else {
  const iteratorFn = getIteratorFn(children);
  // ...
}
```

逻辑很简单，如果 `children` 是数组，那么递归地调用 `mapIntoArray()` 直到 `children` 是单节点。这里用 `subtreeCount` 累加了 `mapIntoArray()` 的返回值，从而实现了对整个子节点树进行遍历计数。

另外，React 中 `isArray` 函数使用的是 `Array.isArray()` 进行数组判断的。

还有值得注意的是，这里是判断 `children` 是否是数组，而不是之前处理单节点时，判断 `map` 后得到的是否是一个数组。前者是判断要去遍历的 `children`，后者是判断已 `map` 得到的 `mappedChild`，这里容易搞混。

#### `children` 可能是可迭代对象的情况

上菜：

```js
if (isArray(children)) {
  // ... 刚分析过了
} else {
  const iteratorFn = getIteratorFn(children);
  if (typeof iteratorFn === 'function') {
    // 如果 children 是有 Iterator 函数的可迭代对象
    const iterableChildren: Iterable<React$Node> & {
      entries: any,
    } = (children: any);

    const iterator = iteratorFn.call(iterableChildren);
    let step;
    let ii = 0;
    // 迭代 children，用子节点递归地调用 mapIntoArray()，直到迭代完毕（也就是 step.done 为 true）
    while (!(step = iterator.next()).done) {
      child = step.value; // 迭代的每个子节点
      nextName = nextNamePrefix + getElementKey(child, ii++);
      subtreeCount += mapIntoArray(
        child,
        array,
        escapedPrefix,
        nextName,
        callback,
      );
    }
  } else if (type === 'object') {
    // 如果 children 不是单个节点，也不是数组或可迭代对象，那么获取它的类型信息并抛错

    // eslint-disable-next-line react-internal/safe-string-coercion
    // 用 String() 得到 children 的类型信息字符串
    const childrenString = String((children: any));

    throw new Error(
      `Objects are not valid as a React child (found: ${
        childrenString === '[object Object]'
          ? 'object with keys {' +
            Object.keys((children: any)).join(', ') +
            '}'
          : childrenString
      }). ` +
        'If you meant to render a collection of children, use an array ' +
        'instead.',
    );
  }
}
```

代码中，先通过 `getIteratorFn()` 函数来尝试获取 `children` 的 `Iterator` 函数。`getIteratorFn()` 的源码：

```js
// 在 /shared/ReactSymbols.js 文件中
const MAYBE_ITERATOR_SYMBOL = typeof Symbol === 'function' && Symbol.iterator;
const FAUX_ITERATOR_SYMBOL = '@@iterator';

// 获取传参的 Iterator 函数，如果传参不是可迭代对象，或者没有 Iterator 函数，那么 return null
export function getIteratorFn(maybeIterable: ?any): ?() => ?Iterator<*> {
  if (maybeIterable === null || typeof maybeIterable !== 'object') {
    return null;
  }
  const maybeIterator =
    (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
    maybeIterable[FAUX_ITERATOR_SYMBOL];
  if (typeof maybeIterator === 'function') {
    return maybeIterator;
  }
  return null;
}
```

之后通过判断取得的 `iteratorFn` 是否是一个 `function` 来判断 `children` 是否是可迭代对象。这是判断可迭代对象的常用手段。

如果是可迭代对象的话，就用 `while` 循环来迭代它。

通过 `const iterator = iteratorFn.call(iterableChildren);` 得到的 `iterator` 有一个 `next()` 方法，调用 `next()` 就会进行下一次遍历。

每次迭代结果赋值给变量 `step`，它是个对象，结构：

```js
{
  done: 布尔值，表示迭代是否结束
  value: 迭代取得的值
}
```

它有两个属性，`done` 表示是否迭代完成，`value` 就是迭代取到的值。

这些是 ES6 Iterator 的相关语法，`done` 的布尔值很关键，它是终止迭代的判断条件。有了 `Iterator`，我们可以控制数据迭代的流程，并且在每次迭代的小步中做更多细分的事情，这比数组的 `forEach()` 和 `map()` 更底层，可以允许我们自定义整个遍历过程，从而突破了 ES 提供的内置遍历函数的局限性。

在迭代过程中，依然是递归调用了 `subtreeCount += mapIntoArray()`。也就是说，**无论 `children` 是个数组还是可迭代对象，处理逻辑最核心的就是递归调用 `mapIntoArray()` 并计数**。

分支 `else if (type === 'object') { throw new Error(); }`，如果没有 `iteratorFn`，也就是 `children` 不可迭代，那么就抛错提示，这种情况一般是调用 API 的时候出 Bug 了。

最后，`return subtreeCount;` 将递归遍历的组件计数返回。至此，这个 200+ 行的最核心的 `mapIntoArray()` 函数就实现完整了 :)

## （四）`React.Children.map()` 源码思路总结

我画了张图来描述 `React.Children.map()` 的执行流程。如图：

其中进行了两次关键的判断：

1. 判断要遍历的 `children` 是单个节点、数组还是可迭代对象；
2. 判断 `map` 得到的 `mappedChild` 是数组、`ReactElement` 还是其他值。

只要判断结果是数组或是可迭代对象，那就应递归调用 `mapIntoArray()` 去继续遍历，直到是一个单节点为止。

理解了这两次判断，那最核心的流程也就搞明白了。

## （五）如何设置节点的 `key`

我们前面还甩了一个问题没有深究，那就是在整个 `map` 过程中，React 是如何设置节点的 `key` 的。

`key` 作为优化渲染的关键属性，一定不能重复。随着子节点树的每一层递归，设置 `key` 时都会用一些连缀符号（比如 `"."`、`":"` 和 `"/"`）去拼接。

示例中，`<PlayChildren>` 有两个子节点 `<span>A</span>` 和 `<span>B</span>`：

```html
<PlayChildren>
  <span>A</span>
  <span>B</span>
</PlayChildren>
```

处理 `props.children` 时对每个子节点又 `return` 了数组：

```js
const playedChildren = React.Children.map(props.children, (c) => [c, [c, c]]);
```

最终渲染的结构是：

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

我把这 6 个子节点的 `key` 打印出来：

0. `{ key: ".0/.0" }`
1. `{ key: ".0/.1:0" }`
2. `{ key: ".0/.1:1" }`
3. `{ key: ".1/.0" }`
4. `{ key: ".1/.1:0" }`
5. `{ key: ".1/.1:1" }`

我们分析下 `key` 相关源码。首先，React 定义了两个分隔符：

```js
// 在 /react/src/ReactChildren.js 文件中
const SEPARATOR = '.'; // 用于命名节点 key 的分隔符
const SUBSEPARATOR = ':'; // 用于命名节点 key 的子分隔符
```

### 第一层 `key`

示例中，`<PlayChildren>` 有两个 `<span>` 作为直接子节点，所以 `props.children` 是个有 2 个元素的数组，就会进入到判 `children` 是数组的流程中：

```js
const nextNamePrefix =
  nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;

if (isArray(children)) {
  for (let i = 0; i < children.length; i++) {
    child = children[i];
    nextName = nextNamePrefix + getElementKey(child, i);
    subtreeCount += mapIntoArray(
      child,
      array,
      escapedPrefix,
      nextName,
      callback,
    );
  }
} {
  // ...
}
```

一开始，在 `mapChildren()` 中调用 `mapIntoArray()` 是这么调的：

```js
mapIntoArray(children, result, '', '', function(child) {
  return func.call(context, child, count++);
});
```

这里第 3、4 个参数分别是 `escapedPrefix`、`nameSoFar`，它们初始都是空字符串 `''`。

所以源码中 `nextNamePrefix` 初始是 `SEPARATOR`，也就是 `"."`。

之后拼接了 `getElementKey(child, i)`

### `getElementKey()` 生成元素的 `key`

继续上菜，`getElementKey()` 源码：

```js
/**
 * Generate a key string that identifies a element within a set.
 * 生成用于标识一组中的元素的 key 字符串。
 *
 * @param {*} element A element that could contain a manual key. // 一个可能包含了手动设置 key 的元素
 * @param {number} index Index that is used if a manual key is not provided. // 如果没有提供手动设置的 key，那就用索引生成
 * @return {string}
 */
function getElementKey(element: any, index: number): string {
  // Do some typechecking here since we call this blindly. We want to ensure
  // that we don't block potential future ES APIs.
  // 这里要做一些类型检查，因为我们是在逐渐摸索地去调用它，确保不会阻碍未来潜在的 ES API。
  // 如果元素手动设置了 key，那么直接返回编码后的 key
  if (typeof element === 'object' && element !== null && element.key != null) {
    return escape('' + element.key);
  }
  // Implicit key determined by the index in the set
  // 如果未手动设置 key，那么这种隐式的 key 由它在一组中所处的索引决定
  // 用 36 进制字符串来表示索引，大于 9 的数字用字母 a~z 表示
  return index.toString(36);
}
```

我们没有手动去设置 `key`，所以 React 就会用节点索引来生成 `key`。这里有个小技巧，源码使用了 `index.toString(36)`。

`toString(36)` 会用 36 进制字符串来表示 10 进制下的索引。为什么要这么做呢？主要的优化点是**缩短表示 `key` 的字符数**。因为：

* 10 进制下只能用数字 0~9 表示 10 个数。用 1 位字符表示了 9 个数；
* 36 进制下，大于 9 的数字可以用 26 个英文字母 a~z 表示。用 1 位字符表示了 35 个数。

所以，**使用多进制数，可以在花费相同的字符串位数下，表示更多的数字。这是多进制数在编程中的一个常见场景**。类似地，多进制数还可以用于将一个长链接转换成短链接，从而节省数据存储空间，等等。原理都是一致的。

示例第一层传入的节点索引分别是 0 和 1，0 和 1 都小于 9，那么 `toString(36)` 后得到 `"0"` 和 `"1"`。

我们把示例第一层的 `key` 分析完，

```js
nextName = nextNamePrefix + getElementKey(child, i);
```

其中，`nextNamePrefix` 分析过了，是 `"."`，调用 `getElementKey(child, i)` 后分别是 `"0"` 和 `"1"`。

所以，最终第一层的 `key` 是 `".0"` 和 `".1"`，与打印结果的一致。

### 第二层 `key`

第一层的 `key` 设置好后，它作为下一层调用 `mapIntoArray()` 的 `nameSoFar` 参数。

在第二层中，`<span>` 作为单个 `ReactElement` 作为 `children` 传递给了 `mapIntoArray()`。这会命中单节点直接调用 `callback` 的条件分支：

```js
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
    // ...
  }
}
```

这次 `nameSoFar` 已经有值了（分别是 `".0"` 和 `".1"`），因此这层得到的 `childKey` 是 `".0"` 和 `".1"`。

由于示例的 `map` 函数是 `(c) => [c, [c, c]]`，因此 `mappedChild` 是个数组。继而：

```js
escapedChildKey = escapeUserProvidedKey(childKey) + '/';
```

`escapeUserProvidedKey()` 函数的源码也很简单：

```js
const userProvidedKeyEscapeRegex = /\/+/g; // 全局匹配 1 个或多个 /
function escapeUserProvidedKey(text: string): string {
  // 将匹配到的 1 个或多个 / 替换成 $&/
  return text.replace(userProvidedKeyEscapeRegex, '$&/');
}
```

目前传入的 `childKey` 中没有 `/`，所以不会匹配到正则，还是原封不动地返回。那么最终 `escapedChildKey` 的值分别是：

* `".0/"`
* `".1/"`

接着 `escapedChildKey` 作为 `mapIntoArray()` 的第 3 个参数 `escapedPrefix` 传入，且参数 `nameSoFar` 传入了 `''`。

### 在后续的递归中处理 `key`

接着，把 `[c, [c, c]]` 作为 `children` 传入 `mapIntoArray()`，这又成了 `children` 是数组的情况。

再继续递归，就成了 `children` 是 `c` 和 `[c, c]` 的情况，这块有点绕，不过如果耐心去理的话是可以理出来的。

对于 `children` 是 `c` 的情况，也就是此时是个单 `ReactElement` 节点了，那么会触发 `if (isValidElement(mappedChild)) {}` 的条件分支：

```js
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
```

> PS：注释中的 `$FlowFixMe` 应该是 FaceBook（后面就叫 Meta 了）React 程序员在向 `Flow` 程序员求助，看来 `Flow` 坑确实多啊。不用 TS 那是因为 TS 是微软的，而 Flow 是 Meta 自家的 :)

要注意，我们一直是通过向 `mapIntoArray()` 函数传入 `escapedPrefix` 和 `nameSoFar` 来拼接 `key` 的，所以此时 `mappedChild` 上没有 `key` 属性。

这里的 `(mappedChild.key && (!child || child.key !== mappedChild.key)` 是为了处理 `map` 前节点本身已经有 `key` 的情况。

至此，我们 `clone` 时为节点附上的新 `key` 分是：

* `".0/.0"`
* `".1/.0"`

而：

* `".0/.1"`
* `".1/.1"`

这两种情况，递归还没结束，别忘了我们还有一层 `children` 是 `[c, c]` 的情况...

感觉头发不知不觉又掉了一搓。

接着脑补，其实 `[c, c]` 在递归中又会命中 `children` 是数组的情况，然后继续递归，又会命中 `children` 是单节点的情况，那就拼呗：


* `".0/.1"` 被继续拼成了分别是：
  * `".0/.1.0"`
  * `".0/.1.1"`
* `".1/.1"` 被继续拼成了分别是：
  * `".1/.1.0"`
  * `".1/.1.1"`

我本以为大功告成了，但是发现上面浏览器打印的 `key` 中有冒号 `:`。当时我的内心是崩溃的。在 `ReactChildren.js` 中又找了几圈，还是没发现递归流程中 `key` 会有 `:` 的情况。

不过也没关系，我们的层级是正确的，而且，目前仅处于渲染的 `react` 模块这个阶段，还没有到后面实际渲染的 `react-dom` 阶段，从 `ReactChildren.js` 提供的其他编码 `key` 的函数来看，很可能后续阶段还会继续处理 `key`。

至此，所有递归情况下设置 `key` 的逻辑就分析完了。

可能有点蒙，不过很正常，关键是吸收它的**思想：提前设置好分隔符，然后在每层递归中，传递了之前分析好的 `key`，这样就能在后续递归中进行拼接。另外 React 还注意了手动为节点设置 `key` 的情况，并且使用了 36 进制数进行短字符优化，这些才是我们分析了一通的精髓**。

## （六）其他 `React.Children` API 实现

搞定了 `React.Children.map()`，其他方法简直索然无味~

接下来就是收获的季节了。

### `React.Children.forEach()`

上菜：

```js
/**
 * Iterates through children that are typically specified as `props.children`.
 * 遍历那些被指定为 `props.children` 的子节点
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenforeach
 *
 * The provided forEachFunc(child, index) will be called for each
 * leaf child.
 * 会为每个叶子节点调用传入的 forEachFunc(child, index)
 *
 * @param {?*} children Children tree container. // 子节点树
 * @param {function(*, int)} forEachFunc // forEach 遍历函数
 * @param {*} forEachContext Context for forEachContext. // forEach 遍历函数的上下文
 */
function forEachChildren(
  children: ?ReactNodeList,
  forEachFunc: ForEachFunc,
  forEachContext: mixed,
): void {
  // React.Children.forEach() 其实内部就是调用了 React.Children.map()，只是不需要返回值罢了
  mapChildren(
    children,
    function() {
      forEachFunc.apply(this, arguments);
      // Don't return anything.
      // 不需要任何 return 内容
    },
    forEachContext,
  );
}
```

正如我注释里写的那样：`React.Children.forEach()` 其实内部就是调用了 `React.Children.map()`，只是不需要返回值罢了。

### `React.Children.count`

又一道菜：

```js
/**
 * Count the number of children that are typically specified as
 * `props.children`.
 * 统计指定为 `props.children` 的子节点（及其子树）共有多少个节点
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrencount
 *
 * @param {?*} children Children tree container.
 * @return {number} The number of children.
 */
function countChildren(children: ?ReactNodeList): number {
  let n = 0;
  mapChildren(children, () => {
    n++;
    // Don't return anything
    // 因为每次递归都会将该函数透传，所以该函数调用了多少次，就意味着已遍历多少个子节点
  });
  return n;
}
```

这个更简单，用 `n` 计数 `map` 函数在递归中被调用了多少次就搞定了！

### `React.Children.only()`

倒数第二道菜：

```js
/**
 * Returns the first child in a collection of children and verifies that there
 * is only one child in the collection.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenonly
 *
 * The current implementation of this function assumes that a single child gets
 * passed without a wrapper, but the purpose of this helper function is to
 * abstract away the particular structure of children.
 * 目前这个函数的实现假定了传入了一个没有任何包裹的单一子节点，但这个辅助函数的目的是抽象出子节点的特殊结构
 *
 * @param {?object} children Child collection structure.
 * @return {ReactElement} The first and only `ReactElement` contained in the
 * structure.
 */
function onlyChild<T>(children: T): T {
  // 验证传参是不是一个 ReactElement，如果是就直接 return，不是的话报错
  if (!isValidElement(children)) {
    throw new Error(
      'React.Children.only expected to receive a single React element child.',
    );
  }

  return children;
}
```

这就更绝了，判断不是 `ReactElement` 就抛错，是的话直接 `return`。

### `React.Children.toArray()`

最后一道菜：

```js
/**
 * Flatten a children object (typically specified as `props.children`) and
 * return an array with appropriately re-keyed children.
 * 将子节点对象（如 `props.children`）展开为一维数组，return 重新设置了合适的 key 的子节点数组
 * 
 * See https://reactjs.org/docs/react-api.html#reactchildrentoarray
 */
function toArray(children: ?ReactNodeList): Array<React$Node> {
  // React.Children.toArray() 其实就是调用了 React.Children.map()
  // 只不过将 map 函数设为将传入的子节点直接 return
  return mapChildren(children, child => child) || [];
}
```

把子节点对象展开，关键是我们固定将 `map` 函数定义为 `child => child`。

## （七）小结

咱们剖析了 `React.Children` 的所有 5 个 API 的源码实现，其中最核心的是 `React.Children.map()`。

双层递归是这次源码之旅的一块挑战。就好像训练跑步时绑了沙袋，等后面写业务或是再遇到递归场景，卸下沙袋，你会发现你好像能飞。

递归抓住几个关键点就好了：

* 传参是什么？
* 返回值是什么？
* 什么条件下，进行了再次调用自己？
* 每次调用自己，有哪些变量是用来缓存中间过程的？
* 什么条件下，递归会终止？

相信搞清楚了这些，那递归的逻辑难题就迎刃而解了。

判断节点是否可以继续遍历的条件，不能单纯去判断数组，因为还有可能是部署了 `Iterator` 接口的可迭代对象。

在设置 `key` 的过程中，使用了 36 进制来减少字符串位数。

当然还有很多其他小点。

有些点是我在写的时候才真正理清的，所以我认为发出来和大家交流很有必要。如果发现文中有任何疏漏或疑问，请随时吐槽，不要吝惜你的思考和文字 ↖(^ω^)↗
