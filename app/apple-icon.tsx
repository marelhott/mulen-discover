import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09241d",
          borderRadius: 42,
        }}
      >
        <div
          style={{
            width: 130,
            height: 130,
            display: "flex",
            position: "relative",
            alignItems: "center",
            justifyContent: "center",
            border: "9px solid #64e7bc",
            borderRadius: 999,
            boxShadow: "0 0 36px rgba(100,231,188,0.34)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              position: "absolute",
              background: "#f7fff9",
              transform: "rotate(45deg)",
              borderRadius: 8,
            }}
          />
          <div
            style={{
              width: 22,
              height: 22,
              position: "absolute",
              borderRadius: 999,
              background: "#0d6552",
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
