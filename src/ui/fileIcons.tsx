import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import AudiotrackOutlinedIcon from "@mui/icons-material/AudiotrackOutlined";
import CodeIcon from "@mui/icons-material/Code";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import MovieOutlinedIcon from "@mui/icons-material/MovieOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import { kindOf } from "../core/files/types";
import type { TreeNode } from "../core/vfs/tree";

export function FileIcon({ node, open }: { node: TreeNode; open?: boolean }) {
  const sx = { fontSize: 18 };
  if (node.kind === "dir") return open ? <FolderOpenIcon sx={{ ...sx, color: "#e3a008" }} /> : <FolderIcon sx={{ ...sx, color: "#e3a008" }} />;
  switch (kindOf(node.name)) {
    case "archive":
      return <ArchiveOutlinedIcon sx={{ ...sx, color: "primary.main" }} />;
    case "image":
      return <ImageOutlinedIcon sx={{ ...sx, color: "#2f9e44" }} />;
    case "audio":
      return <AudiotrackOutlinedIcon sx={{ ...sx, color: "#7048e8" }} />;
    case "video":
      return <MovieOutlinedIcon sx={{ ...sx, color: "#c2255c" }} />;
    case "script":
      return <CodeIcon sx={{ ...sx, color: "#1c7ed6" }} />;
    case "rpyc":
      return <LockOpenOutlinedIcon sx={{ ...sx, color: "#1c7ed6" }} />;
    case "save":
      return <SaveOutlinedIcon sx={{ ...sx, color: "#0ca678" }} />;
    case "font":
      return <TextFieldsIcon sx={sx} />;
    case "text":
      return <DescriptionOutlinedIcon sx={sx} />;
    default:
      return <InsertDriveFileOutlinedIcon sx={{ ...sx, color: "text.secondary" }} />;
  }
}
