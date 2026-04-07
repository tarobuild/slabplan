import axios from "axios"

const baseURL = import.meta.env.VITE_API_BASE_URL || "/api"

export const authApi = axios.create({
  baseURL,
  withCredentials: true,
})

export const api = axios.create({
  baseURL,
  withCredentials: true,
})
