export default function getBaseUrl() {
  const baseUrl = process.env.UNPKG_BASE_URL || '/unpkg';
  return baseUrl.replace(/\/+$/, '');
}
