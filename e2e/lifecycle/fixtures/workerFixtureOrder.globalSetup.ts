export default function () {
  console.log('[scope-order] global setup');
  return () => {
    console.log('[scope-order] global cleanup');
  };
}
