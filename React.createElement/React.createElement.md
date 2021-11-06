# JSX 背后的魔力源泉 - React.createElement

编码 React 应用往往会配合着 [JSX](https://reactjs.org/docs/introducing-jsx.html)，使用它可以让我们在 JS 中“写 HTML”，比如这样：

```js
const name = 'JSX';
const element = <h1 id="title">Hello {name}</h1>;
```

当然，这不是真的 HTML，这只是一种语法糖。这种写法有点像模板语法，但又天生有着 JS 的所有能力，这让 UI 视图与逻辑紧密结合，非常灵活。

本文会揭开 JSX 的神秘面纱，看看它魔力的源泉究竟是什么。

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
