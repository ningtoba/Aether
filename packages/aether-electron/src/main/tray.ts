/**
 * System tray for Aether Desktop
 *
 * Creates a tray icon with context menu for show/hide and quit.
 */

import { app, Menu, Tray, nativeImage } from "electron";
import type { BrowserWindow } from "electron";

let tray: Tray | null = null;

export interface TrayDeps {
  showMainWindow: () => void;
  getMainWindow: () => BrowserWindow | null;
}

export function createTray({ showMainWindow }: TrayDeps): void {
  if (tray) return;

  // Use a simple 16x16 icon — in production replace with app icon
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEoSURBVDiNpZMxTsNAEEX/rNeOAwUlHVdA4gJcAokLUNDRcAQkLkCBaOgouQIVF+AIcAQkLkCBaNh4Z3cohuxarJNo3p9m9f9qjQjwf4KILgA8iuheRHcici0iZwCgIsci8iCiNyJ6E5F9ETkUkcaYqbX2SkQOAeCq67pjjDHOuQMR2QHwKiLPIjIH8CUiXyLyKSLfIvIjIq21djVJkr1hGBLRdgzDMI7jhzFmLyLbW62qalVV1Za1djNN0+1hGJZpmm6EYXgYx/FB0zRHEXEc0znnGGN0zrkQkUZEHkUkF5FTESlFZF1E1iLyISKvIvIkIisRmYnIn4goi8jEa22SJM0YhnPnnHPOOQBYq+t6FUXR/L+KiN4B/ABYAZj/Pmc6+ckf6X7/BV4BMQO7권AAAAAASUVORK5CYII=",
  );

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Aether");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Window", click: () => showMainWindow() },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", () => showMainWindow());
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
