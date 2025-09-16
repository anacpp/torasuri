declare module 'qrcode' {
  interface QRCodeToDataURLOptions { margin?: number; scale?: number; }
  function toDataURL(text: string, opts?: QRCodeToDataURLOptions): Promise<string>;
  const _default: { toDataURL: typeof toDataURL };
  export default _default;
  export { toDataURL };
}
