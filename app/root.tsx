import "@mantine/core/styles.css";
import "./styles/app.css";
import {
  Anchor,
  Button,
  Container,
  Group,
  Image,
  Loader,
  MantineProvider,
  Modal,
  Select,
  Text,
  TextInput,
  createTheme,
} from "@mantine/core";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import logoUrl from "./assets/logo.webp";

const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  fontFamily: "system-ui, sans-serif",
  headings: { fontFamily: "system-ui, sans-serif" },
  components: {
    Button: Button.extend({ styles: { root: { minHeight: 44 } } }),
    TextInput: TextInput.extend({ styles: { input: { minHeight: 44 } } }),
    Select: Select.extend({ styles: { input: { minHeight: 44 } } }),
    Modal: Modal.extend({ defaultProps: { centered: true } }),
  },
});
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <title>NCE Fighter</title>
        <Meta />
        <Links />
      </head>
      <body>
        <MantineProvider theme={theme} forceColorScheme="light">
          <Container size="md" py="lg">
            <Group mb="xl" justify="space-between" wrap="nowrap">
              <Anchor
                component={Link}
                to="/library"
                fw={800}
                fz={32}
                underline="never"
              >
                NCE Fighter
              </Anchor>
              <Image
                src={logoUrl}
                alt=""
                w={100}
                h={100}
                fit="contain"
                draggable={false}
                style={{ flexShrink: 0 }}
              />
            </Group>
            {children}
          </Container>
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
        <Analytics mode={import.meta.env.PROD ? "production" : "development"} />
      </body>
    </html>
  );
}
export default function App() {
  return <Outlet />;
}
export function HydrateFallback() {
  return (
    <Group>
      <Loader size="sm" />
      <Text>正在读取本地课文…</Text>
    </Group>
  );
}
export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <>
      <Text role="alert">
        {isRouteErrorResponse(error) && error.status === 404
          ? "页面不存在。"
          : "页面加载失败，请刷新重试。"}
      </Text>
      <Anchor component={Link} to="/library">
        返回课文库
      </Anchor>
    </>
  );
}
