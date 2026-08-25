import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff8ef",
          borderRadius: 16,
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            display: "flex",
            position: "relative",
            alignItems: "center",
            justifyContent: "center",
            border: "3px solid #f5bd82",
            borderRadius: 999,
            boxShadow: "0 0 14px rgba(249,115,22,0.2)",
          }}
        >
          <div
            style={{
              width: 19,
              height: 19,
              position: "absolute",
              background: "#f97316",
              transform: "rotate(45deg)",
              borderRadius: 3,
            }}
          />
          <div
            style={{
              width: 8,
              height: 8,
              position: "absolute",
              borderRadius: 999,
              background: "#fff8ef",
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
