import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("library", "routes/library.tsx"),
  route("import", "routes/import.tsx"),
  route("resources", "routes/resources.tsx"),
  route("lessons/:lessonId", "routes/lesson.tsx"),
  route("training/:sessionId", "routes/training.tsx"),
  route("results/:sessionId", "routes/result.tsx"),
] satisfies RouteConfig;
