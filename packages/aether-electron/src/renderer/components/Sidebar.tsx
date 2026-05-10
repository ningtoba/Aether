import React from "react";
import { PageId, PAGES } from "../App";

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar flex flex-col w-56 bg-[#0a0a0d] border-r border-[#1e1e24] overflow-y-auto">
      {/* App logo area */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-[#1e1e24]">
        <span className="text-xl">✦</span>
        <span className="text-sm font-bold text-gray-200 tracking-wider uppercase">Aether</span>
      </div>

      {/* Navigation items */}
      <div className="flex flex-col gap-1 p-3">
        {PAGES.map((page) => {
          const isActive = currentPage === page.id;
          return (
            <button
              key={page.id}
              onClick={() => onNavigate(page.id)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left
                ${isActive
                  ? "bg-[#6335e7]/20 text-[#a78bfa] font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#ffffff08]"
                }
              `}
            >
              <span className="text-base w-5 text-center flex-shrink-0">{page.icon}</span>
              <span>{page.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom spacer */}
      <div className="mt-auto p-4 border-t border-[#1e1e24]">
        <span className="text-[10px] text-gray-600">v1.0.0</span>
      </div>
    </nav>
  );
}
