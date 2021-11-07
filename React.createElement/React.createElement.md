# JSX 背后的魔力源泉 - React.createElement

编码 React 应用往往会配合着 [JSX](https://reactjs.org/docs/introducing-jsx.html)，使用它可以让我们在 JS 中“写 HTML”，比如这样：

```js
const name = 'JSX';
const element = <h1 id="title">Hello {name}</h1>;
```

当然，这不是真的 HTML，这只是一种语法糖。这种写法有点像模板语法，但又天生有着 JS 的所有能力，这让 UI 视图与逻辑紧密结合，非常灵活。

本文会揭开 JSX 的神秘面纱，看看它魔力的源泉究竟是什么。涉及的所有源码我都在 [react-wisdom-codebase](https://github.com/roc-an/react-wisdom-codebase) 进行了详细的注释。

## Babel 将 JSX 编译成 JS

[Babel](https://babeljs.io/) 是一个 JS 编译器，它可以将 ES6+ 代码编译成 ES5 从而兼容老浏览器。

当然，通过 [@babel/preset-react](https://babeljs.io/docs/en/babel-preset-react) Babel 也可以将 JSX 编译成 JS。这样我们的 React 应用在每次重启本地服务还有打生产环境包时，Babel 都会将我们写的 JSX 代码编译成 JS。

在 Babel 官网的 [试一试](https://babeljs.io/repl) 里可以玩玩这个编译过程。如果把本文开头的那段 JSX 键入，就能编译得到：

```js
var name = "JSX";
var element = /*#__PURE__*/ React.createElement("h1", { id: "title" }, "Hello ", name);
```

会发现 `<h1>` 标签被编译成了 [`React.createElement()`](https://reactjs.org/docs/react-api.html#createelement)。

调用 `React.createElement()` 会创建一个 React 元素（[React element](https://reactjs.org/docs/rendering-elements.html)），我们后面再详细看 React 元素。

`React.createElement()` 的语法结构：

```js
React.createElement(
  type,
  [props],
  [...children]
)
```

> ps：语法结构里的方括号 `[]` 不是数组，而是“可选”的意思。

其中，对于要创建的 React 元素：

* `type` 是元素类型；
* `props` 是元素属性；
* `children` 是元素的子节点列表（注意不是数组）。比如，示例中 `"Hello "` 和 `name` 这俩子节点依次传给了 `React.createElement()`。

现在咱们知道了，原来**在 JSX 文件中写的一个个标签，都会被编译成用 `React.createElement()` 创建的 React 元素**。

而且每个元素还支持多个子元素，这样的话，如果标签嵌套着标签，就自顶向下形成了一棵 React 元素树。比如标签是这样嵌套的：

```jsx
const ul = (
  <ul>
    <li><span>断剑</span>重铸之日</li>
    <li><span>骑士</span>归来之时</li>
  </ul>
);
```

就会被编译成：

```js
var ul = /*#__PURE__*/ React.createElement("ul", null,
  /*#__PURE__*/ React.createElement("li", null,
    /*#__PURE__*/ React.createElement("span", null, "\u65AD\u5251"), "\u91CD\u94F8\u4E4B\u65E5"),
  /*#__PURE__*/ React.createElement("li", null,
    /*#__PURE__*/ React.createElement("span", null, "\u9A91\u58EB"), "\u5F52\u6765\u4E4B\u65F6")
);
```

乍一看有点乱，这是因为：

* 中文字符被转成了 Unicode 码；
* 加了 `/*#__PURE__*/` 注释，这是 Babel 编译 ES6 class 时加上的，主要是为了给 [Uglify](https://github.com/mishoo/UglifyJS) 和 [babel-minify](https://github.com/babel/minify) 在压缩时剔除无用代码做提示的（详细可以看 [这里](https://babeljs.io/blog/2018/08/27/7.0.0#pure-annotation-support)）。

如果我把中文还原，再把注释去掉，就清晰多了：

```js
var ul = React.createElement("ul", null,
  React.createElement("li", null, React.createElement("span", null, "断剑"), "重铸之日"),
  React.createElement("li", null, React.createElement("span", null, "骑士"), "归来之时")
);
```

标签结构与函数调用结构一致。

由此可见，`React.createElement()` 这个顶层 API 才是从 JSX 代码到一步步最终渲染成实际 DOM 的关键所在！ 

## 一探 `React.createElement()`

沿着 [`/packages/react/index.js`](https://github.com/roc-an/react-wisdom-codebase/blob/main/packages/react/index.js) 这个作为 react 包的入口寻找，不难找到 `React.createElement()` 是在 [`ReactElement.js`](https://github.com/roc-an/react-wisdom-codebase/blob/main/packages/react/src/ReactElement.js#L359) 中定义的。

我把 `React.createElement()` 源码贴出来，去掉了 `__DEV__` 部分的代码，这些大多是开发环境的警告处理，不影响核心逻辑，另外我加了详细的注释：

```js
/**
 * Create and return a new ReactElement of the given type.
 * See https://reactjs.org/docs/react-api.html#createelement
 * 根据给定的 type 创建并 return 一个新的 ReactElement
 * @param type: ReactElement 类型，可以是标签名字符串（如 'div'、'span'），React component 类型（一个 class 或 function），
 *   或是 React fragment 类型
 * @param config: 创建 ReactElement 的配置项，主要是 ReactElement 的属性，以键值对形式存在这个对象里
 * @param children: 要创建的 ReactElement 的子节点，可以是 1 或多个，会通过 arguments 取到
 */
export function createElement(type, config, children) {
  let propName;

  // Reserved names are extracted
  const props = {};

  let key = null;
  let ref = null;
  let self = null;
  let source = null;

  // 判断 config 中否有有效的 ref 和 key，并赋值给变量
  if (config != null) {
    if (hasValidRef(config)) {
      ref = config.ref;
    }
    if (hasValidKey(config)) {
      key = '' + config.key;
    }

    self = config.__self === undefined ? null : config.__self;
    source = config.__source === undefined ? null : config.__source;
    // Remaining properties are added to a new props object
    // 除了内置属性（也就是 RESERVED_PROPS 中的 key, ref, __self, __source，这些是框架处理 ReactElement 而内置的，
    // 并不是我们写应用时在 React 组件上定义的 props），剩余的都添加到 props 这个对象
    for (propName in config) {
      if (
        hasOwnProperty.call(config, propName) &&
        !RESERVED_PROPS.hasOwnProperty(propName)
      ) {
        props[propName] = config[propName];
      }
    }
  }

  // Children can be more than one argument, and those are transferred onto
  // the newly allocated props object.
  // Children 可以是 1 或多个，createElement 函数的第 3 个及以后的参数都作为子节点
  // 通过 arguments 判断、处理后，props.children 是一个节点或节点数组
  const childrenLength = arguments.length - 2;
  if (childrenLength === 1) {
    props.children = children;
  } else if (childrenLength > 1) {
    const childArray = Array(childrenLength);
    for (let i = 0; i < childrenLength; i++) {
      childArray[i] = arguments[i + 2];
    }
    props.children = childArray;
  }

  // Resolve default props
  // 处理默认的 props
  // 比如 class Comp extends React.Component
  // Comp.defaultProps = {} 这种情况
  if (type && type.defaultProps) {
    const defaultProps = type.defaultProps;
    for (propName in defaultProps) {
      // 遍历 defaultProps 上的 key，如果上面处理过的 props 上这个 key 没定义值，那值就用 defaultProps 上的
      // 注意判断条件是 undefined，换句话说，如果 props 上 key 的值是 null，并不会采用默认值
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }
  return ReactElement(
    type,
    key,
    ref,
    self,
    source,
    ReactCurrentOwner.current,
    props,
  );
}
```

归纳来看，`React.createElement()` 函数做了这几件事：

1. 验证处理传入的 `config` 各属性，验证内置属性 `key`, `ref`, `__self`, `__source` 的有效性，其余非内置属性将作为 ReactElement 的 `props`；
2. 通过 `arguments` 处理传入的子节点；
3. 处理默认 `props`；
4. 最终将所有处理后的数据，传入 `ReactElement()` 函数并作为 `React.createElement()` 的 `return`。

一句话，**`React.createElement()` 的职责，是在真正创建 ReactElement 前做一层对传入数据的处理**。

## `ReactElement` 是什么

接着找到 `ReactElement()` 函数的定义：

```js
/**
 * Factory method to create a new React element. This no longer adheres to
 * the class pattern, so do not use new to call it. Also, instanceof check
 * will not work. Instead test $$typeof field against Symbol.for('react.element') to check
 * if something is a React Element.
 * 
 * 创建新 ReactElement 的工厂函数。命名虽然是大驼峰，但它并不是一个 class，所以不要用 new 调用，实例检测也不会奏效。
 * 取而代之的是，可以通过判断 $$typeof 是否是 Symbol.for('react.element') 来检查是否是 ReactElement。
 *
 * @param {*} type
 * @param {*} props
 * @param {*} key
 * @param {string|object} ref
 * @param {*} owner
 * @param {*} self A *temporary* helper to detect places where `this` is
 * different from the `owner` when React.createElement is called, so that we
 * can warn. We want to get rid of owner and replace string `ref`s with arrow
 * functions, and as long as `this` and owner are the same, there will be no
 * change in behavior.
 * @param {*} source An annotation object (added by a transpiler or otherwise)
 * indicating filename, line number, and/or other information.
 * @internal
 */
const ReactElement = function(type, key, ref, self, source, owner, props) {
  const element = {
    // This tag allows us to uniquely identify this as a React Element
    // 该属性允许我们唯一标识是否是 ReactElement
    $$typeof: REACT_ELEMENT_TYPE,

    // Built-in properties that belong on the element
    // 内置属性
    type: type, // 是用来记录标签名字符串、class component、function component、fragment 这些类型的
    key: key,
    ref: ref,
    props: props,

    // Record the component responsible for creating this element.
    // 记录负责创建该元素的组件
    _owner: owner,
  };
  return element;
};
```

`self` 和 `source` 仅在开发环境下使用，是用来做警告提示的，可以忽略。

`$$typeof` 很关键，它是用来唯一识别 ReactElement 类型的，这些类型都定义在 [shared/ReactSymbols.js](https://github.com/roc-an/react-wisdom-codebase/blob/main/packages/shared/ReactSymbols.js)，我把它们贴出来：

```js
if (typeof Symbol === 'function' && Symbol.for) {
  const symbolFor = Symbol.for;
  REACT_ELEMENT_TYPE = symbolFor('react.element');
  REACT_PORTAL_TYPE = symbolFor('react.portal');
  REACT_FRAGMENT_TYPE = symbolFor('react.fragment');
  REACT_STRICT_MODE_TYPE = symbolFor('react.strict_mode');
  REACT_PROFILER_TYPE = symbolFor('react.profiler');
  REACT_PROVIDER_TYPE = symbolFor('react.provider');
  REACT_CONTEXT_TYPE = symbolFor('react.context');
  REACT_FORWARD_REF_TYPE = symbolFor('react.forward_ref');
  REACT_SUSPENSE_TYPE = symbolFor('react.suspense');
  REACT_SUSPENSE_LIST_TYPE = symbolFor('react.suspense_list');
  REACT_MEMO_TYPE = symbolFor('react.memo');
  REACT_LAZY_TYPE = symbolFor('react.lazy');
  REACT_SCOPE_TYPE = symbolFor('react.scope');
  REACT_DEBUG_TRACING_MODE_TYPE = symbolFor('react.debug_trace_mode');
  REACT_OFFSCREEN_TYPE = symbolFor('react.offscreen');
  REACT_LEGACY_HIDDEN_TYPE = symbolFor('react.legacy_hidden');
  REACT_CACHE_TYPE = symbolFor('react.cache');
}
```

这些类型通过 [`Symbol.for()`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Symbol/for) 注册到了全局，这是**原始数据类型 `Symbol` 在框架中的使用场景，用来唯一标识类型**。

另外，`shared` 是个共享模块，定义了被其他模块所共享的函数和常量。

## TODO

* `ReactElement()` 函数只返回了个对象，那后续是怎么渲染成 DOM 的呢？
