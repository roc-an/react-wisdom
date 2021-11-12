import { StrictMode } from "react";
import ReactDOM from "react-dom";

import ReactChildrenMapUsage from "./ReactChildrenMapUsage";

const rootElement = document.getElementById("root");
ReactDOM.render(
  <StrictMode>
    <ReactChildrenMapUsage />
  </StrictMode>,
  rootElement
);
