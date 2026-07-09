import React from 'react';

type EmptyPreviewOverlayProps = {
  message: string;
};

export const EmptyPreviewOverlay: React.FC<EmptyPreviewOverlayProps> = ({
  message,
}) => {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/[0.02]">
      <span className="text-sm text-(--muted-foreground)">{message}</span>
    </div>
  );
};
