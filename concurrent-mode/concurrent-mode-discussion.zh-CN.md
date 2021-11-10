# 并发“模式”（Concurrent "Mode"）下都发生些什么

## 概述

React18 将加入 `startTransition`、`useDeferredValue`、并发 `Suspense` 语法、`SuspenseList` 等等这些新特性。为了推动这些新特性，React 引入了一些思想，比如协调式多任务处理（Cooperative Multitasking）、基于优先级渲染（Priority-based Rendering）、调度（Scheduling）以及中断（Interruptions）。

得益于能智能地决定何时进行子树渲染（或中止渲染），这些特性解锁了新一代性能和用户体验。这些新特性的开销，仅仅是从思想上乐观地拥抱它们并把代码写出来。

为了帮助用户搞清楚他们的代码是否兼容，React 加入了很多开发环境下的警告和行为，我们叫它严格模式 `StrictMode`。在严格模式下，会警告用户不安全的行为，并把不当地使用并发特性的 bug 暴露出来。我们在 React16.3 引入了 `StrictMode`，好让社区为这些新功能提前做好准备。

这个帖子是面向那些紧密跟进实验性分支、想知道 Concurrent "Mode" 究竟发生了什么的人们。我们会提供如何推动这些新特性的概览，并解释说明为什么说其实没有并发模式这一模式，而只是一些并发功能特性罢了。
