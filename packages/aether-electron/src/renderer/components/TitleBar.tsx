import React from "react";

interface TitleBarProps {
  isMaximized: boolean;
}

export function TitleBar({ isMaximized }: TitleBarProps) {
  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleMaximizeRestore = () => {
    window.electronAPI?.maximizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <header className="titlebar flex items-center justify-between h-10 bg-[#0a0a0d] select-none" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
      {/* Left: Title */}
      <div className="flex items-center gap-2 pl-4">
        <span className="text-sm font-semibold text-gray-200 tracking-wide">Aether</span>
      </div>

      {/* Right: Window controls */}
      <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={handleMinimize}
          className="window-control hover:bg-[#ffffff14] px-4 h-full text-gray-400 hover:text-gray-200 transition-colors text-xs"
          aria-label="Minimize"
        >
          {/* minimize icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1.5" y="5.5" width="9" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          onClick={handleMaximizeRestore}
          className="window-control hover:bg-[#ffffff14] px-4 h-full text-gray-400 hover:text-gray-200 transition-colors text-xs"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            /* restore icon */
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3.5" y="1.5" width="7" height="7" rx="0.5" stroke="currentColor" fill="none" />
              <rect x="1.5" y="3.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            /* maximize icon */
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" stroke="currentColor" fill="none" />
            </svg>
          )}
        </button>

        <button
          onClick={handleClose}
          className="window-control hover:bg-red-500/80 px-4 h-full text-gray-400 hover:text-white transition-colors text-xs"
          aria-label="Close"
        >
          {/* close icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
