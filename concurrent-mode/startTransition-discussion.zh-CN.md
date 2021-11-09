# 新特性：startTransition

> 原 Discussion：https://github.com/reactwg/react-18/discussions/41

## 概述

在 React18 中我们引进了一个新 API，让应用即便在大屏更新场景下仍能保持响应。这个新 API 通过将指定的更新标记为“transition”来大幅提高用户交互体验。React 会让你提供 state 转变时的视觉反馈并在转变过程中保持浏览器可响应。

* [真实案例：为慢渲染加入 startTransition](https://github.com/reactwg/react-18/discussions/65)

## 解决什么问题？

