# JSX 背后的魔力源泉 - React.createElement

编码 React 应用往往会配合着 [JSX](https://reactjs.org/docs/introducing-jsx.html)，使用它可以让我们在 JS 中“写 HTML”，比如这样：

```js
const name = 'JSX';
const element = <h1 id="title">Hello {name}</h1>;
```

当然，这不是真的 HTML，这只是一种语法糖。这种写法有点像模板语法，但又天生有着 JS 的所有能力，这让 UI 视图与逻辑紧密结合，非常灵活。

本文会揭开 JSX 的神秘面纱，看看它魔力的源泉究竟是什么。
