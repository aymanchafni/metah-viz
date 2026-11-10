/** @type {import('next').NextConfig} */
const nextConfig = {
  // The browser talks to the FastAPI backend directly (NEXT_PUBLIC_API_URL, CORS enabled):
  // proxying Server-Sent Events through Next.js rewrites can buffer the stream.
  output: "standalone",
};

export default nextConfig;
