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
