import React from "react";

export function ProviderPage() {
  return (
    <div className="provider-page p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Provider Management</h1>
        <p className="text-gray-500 text-sm">Configure and manage AI providers (OpenAI, Anthropic, local models, etc.)</p>
      </div>
      <div className="flex items-center justify-center h-64 bg-[#14141a] border border-dashed border-[#2a2a33] rounded-2xl">
        <p className="text-gray-600 text-sm">Provider configuration interface coming soon</p>
      </div>
    </div>
  );
}
