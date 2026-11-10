import axios from 'axios';

const configuredApiBase = import.meta.env.VITE_API_BASE_URL;
const api = axios.create({ baseURL: configuredApiBase || '/api', withCredentials: true, timeout: 30000 });
api.interceptors.response.use((response) => response, (error) => {
  const message = error.response?.data?.message || error.response?.data?.detail || error.message || 'Request failed.';
  return Promise.reject(new Error(message));
});
export const assetUrl = (path) => path?.startsWith('http') ? path : path || '';
export default api;

