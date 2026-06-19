export function computeThumbHeight(args: {
  clientHeight: number;
  scrollHeight: number;
  minThumbPx?: number;
}): number {
  const { clientHeight, scrollHeight } = args;
  const minThumbPx = args.minThumbPx ?? 24;
  const ratio = clientHeight / scrollHeight;
  const natural = clientHeight * ratio;
  return Math.min(clientHeight, Math.max(minThumbPx, natural));
}

export function computeThumbTranslateY(args: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  thumbHeight: number;
}): number {
  const { scrollTop, scrollHeight, clientHeight, thumbHeight } = args;
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0) return 0;
  const clamped = Math.min(maxScroll, Math.max(0, scrollTop));
  const trackTravel = clientHeight - thumbHeight;
  return (clamped / maxScroll) * trackTravel;
}

export function scrollFromDrag(args: {
  dragRatio: number;
  scrollHeight: number;
  clientHeight: number;
}): number {
  const { dragRatio, scrollHeight, clientHeight } = args;
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, dragRatio));
  return ratio * maxScroll;
}
