# 并发渲染模式（Concurrent Mode）

## React 18 支持哪些并发特性？

React 18 是首个加入并发功能（可选）的正式版本，主要功能有：

* [`startTransition`](https://github.com/reactwg/react-18/discussions/41)：支持在大规模 state 过渡中仍保持 UI 响应；
* `useDeferredValue`：支持延迟更新屏幕中次重要的内容；
* `<SuspenseList>`：支持协调加载指示器的出现顺序；
* [有着可选 hydration 的流式 SSR](https://github.com/reactwg/react-18/discussions/37)：使应用更快完成加载而可交互。

## 参考资源

* [Introducing React 18](https://github.com/reactwg/react-18/discussions/4)
