import { Button, IconButton, Tooltip, type ButtonProps } from "@mui/material";
import type { ReactNode } from "react";

/** Text button on wider screens, icon-only (with tooltip and accessible name) on phones. */
export function BarButton({ icon, label, onClick, variant, ...rest }: { icon: ReactNode; label: string; onClick(e: React.MouseEvent<HTMLElement>): void; variant?: ButtonProps["variant"] } & Pick<ButtonProps, "aria-haspopup">) {
  return (
    <>
      <Button size="small" variant={variant} startIcon={icon} onClick={onClick} sx={{ display: { xs: "none", sm: "inline-flex" } }} {...rest}>
        {label}
      </Button>
      <Tooltip title={label}>
        <IconButton size="small" color={variant === "contained" ? "primary" : "default"} onClick={onClick} aria-label={label} sx={{ display: { xs: "inline-flex", sm: "none" } }} {...rest}>
          {icon}
        </IconButton>
      </Tooltip>
    </>
  );
}
