import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("library", "routes/library.tsx"),
  route("import", "routes/import.tsx"),
  route("lessons/:lessonId", "routes/lesson.tsx"),
] satisfies RouteConfig;
