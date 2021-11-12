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
