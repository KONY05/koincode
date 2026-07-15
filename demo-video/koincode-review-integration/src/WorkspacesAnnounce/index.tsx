import React from "react";
import { AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { colors, fontFamilyMono, fontFamilySans } from "../DemoLaunch/theme";

loadFont();

const FOLDERS = ["~/api", "~/web", "~/mobile"];

const FolderChip: React.FC<{ path: string }> = ({ path }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "14px 22px",
      borderRadius: 10,
      background: colors.surface,
      border: `1px solid ${colors.surfaceBorder}`,
      fontFamily: fontFamilyMono,
      fontSize: 22,
      color: colors.white,
    }}
  >
    <span style={{ color: colors.amber }}>▸</span>
    {path}
  </div>
);

export const WorkspacesAnnounce: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: colors.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Logo */}
      <div
        style={{
          position: "absolute",
          top: 64,
          left: 80,
          display: "flex",
          fontFamily: fontFamilySans,
          fontWeight: 800,
          fontSize: 36,
          letterSpacing: 1,
        }}
      >
        <span style={{ color: colors.white }}>KOIN</span>
        <span style={{ color: colors.amber }}>CODE</span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 70,
          right: 80,
          padding: "8px 18px",
          borderRadius: 999,
          border: `1px solid ${colors.amber}`,
          fontFamily: fontFamilySans,
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: 2,
          color: colors.amber,
        }}
      >
        NEW
      </div>

      {/* Headline */}
      <div
        style={{
          fontFamily: fontFamilySans,
          fontWeight: 800,
          fontSize: 72,
          lineHeight: "84px",
          textAlign: "center",
          color: colors.white,
          maxWidth: 1200,
        }}
      >
        Workspaces are now available
        <br />
        on <span style={{ color: colors.amber }}>KOINCODE</span>
      </div>

      {/* Subtext */}
      <div
        style={{
          marginTop: 28,
          fontFamily: fontFamilySans,
          fontSize: 26,
          color: colors.muted,
          textAlign: "center",
          maxWidth: 780,
        }}
      >
        Pull in multiple projects and files into one session.
      </div>

      <div
        style={{
          marginTop: 14,
          fontFamily: fontFamilyMono,
          fontSize: 20,
          color: colors.muted,
          textAlign: "center",
        }}
      >
        Run <span style={{ color: colors.amber }}>/add-dir</span> to add a
        directory to the session context.
      </div>

      {/* Illustration: folders converging into one terminal session */}
      <div
        style={{
          marginTop: 64,
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {FOLDERS.map((path) => (
            <FolderChip key={path} path={path} />
          ))}
        </div>

        <div
          style={{
            fontFamily: fontFamilySans,
            fontSize: 32,
            color: colors.amber,
          }}
        >
          →
        </div>

        <div
          style={{
            padding: "22px 30px",
            borderRadius: 12,
            background: colors.surface,
            border: `1px solid ${colors.teal}`,
            fontFamily: fontFamilyMono,
            fontSize: 22,
            color: colors.white,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: colors.teal }}>$</span> koincode
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: colors.muted }}>— 1 session</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
