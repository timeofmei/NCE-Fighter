import { Alert, Button, Stack } from "@mantine/core";
import { useRevalidator } from "react-router";

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";
export function LoadError({ message }: { message: string }) {
  const revalidator = useRevalidator();
  return (
    <Stack>
      <Alert color="red" title="读取失败" role="alert">
        {message}
      </Alert>
      <Button
        variant="light"
        loading={revalidator.state !== "idle"}
        onClick={() => void revalidator.revalidate()}
      >
        重试
      </Button>
    </Stack>
  );
}
