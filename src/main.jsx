import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./arena.css";
import { consumeAuthCallback } from "./services/authCallback";

consumeAuthCallback().then((error) =>
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      {error && (
        <p className="container auth-callback-error" role="alert">
          {error}
        </p>
      )}
      <App />
    </React.StrictMode>,
  ),
);
