import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card } from "@mantine/core";
import { Link } from "react-router";

interface Props {
  to: string;
  title: string;
  state: string;
  children: ReactNode;
  onLongPress?(): void;
}

export function LessonCard({ to, title, state, children, onLongPress }: Props) {
  const [pressing, setPressing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setPressing(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Card
      component={Link}
      to={to}
      aria-label={title || "未命名课文"}
      withBorder
      className="lesson-card"
      data-state={state}
      data-pressing={pressing || undefined}
      onPointerDown={(event) => {
        cancel();
        suppressClick.current = false;
        if (
          !onLongPress ||
          !event.isPrimary ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        origin.current = { x: event.clientX, y: event.clientY };
        setPressing(true);
        timer.current = setTimeout(() => {
          timer.current = undefined;
          suppressClick.current = true;
          setPressing(false);
          onLongPress();
        }, 650);
      }}
      onPointerMove={(event) => {
        if (
          timer.current &&
          Math.hypot(
            event.clientX - origin.current.x,
            event.clientY - origin.current.y,
          ) > 10
        ) {
          suppressClick.current = true;
          cancel();
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={() => {
        suppressClick.current = true;
        cancel();
      }}
      onPointerLeave={() => {
        if (timer.current) {
          suppressClick.current = true;
          cancel();
        }
      }}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          suppressClick.current = false;
        }
      }}
      onContextMenu={(event) => {
        if (onLongPress) event.preventDefault();
      }}
      onDragStart={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={(event) => {
        if (
          onLongPress &&
          (event.key === "Delete" || event.key === "Backspace")
        ) {
          event.preventDefault();
          cancel();
          onLongPress();
        }
      }}
    >
      {children}
    </Card>
  );
}
