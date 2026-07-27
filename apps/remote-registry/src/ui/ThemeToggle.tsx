import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const THEME_COLORS: Record<Theme, string> = {
  dark: "#0B0D0C",
  light: "#FAFAF7",
};

function getCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);

  try {
    localStorage.setItem("wm.theme", theme);
  } catch {
    return;
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getCurrentTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={`${theme === "dark" ? "Dark" : "Light"} theme active. Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark"
        ? <Moon size={15} strokeWidth={1.75} aria-hidden="true" />
        : <Sun size={15} strokeWidth={1.75} aria-hidden="true" />}
      <span className="theme-toggle__label" aria-hidden="true">
        {theme === "dark" ? "Dark" : "Light"}
      </span>
    </button>
  );
}
