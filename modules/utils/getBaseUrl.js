export default function getBaseUrl() {
  const baseUrl = process.env.UNPKG_BASE_URL || '/';
  return baseUrl.replace(/\/+$/, '');
}
