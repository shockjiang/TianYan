interface VideoViewerProps {
  src: string;
  name: string;
  autoplay?: boolean;
}

export function VideoViewer({ src, name, autoplay = false }: VideoViewerProps) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: '#000' }}>
      <video
        controls
        autoPlay={autoplay}
        style={{ maxWidth: '100%', maxHeight: '100%' }}
        key={src}
      >
        <source src={src} />
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
