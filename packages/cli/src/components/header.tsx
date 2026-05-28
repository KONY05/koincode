export function Header() {
  return (
    <box justifyContent="center" alignItems="center" gap={2}>
      <box flexDirection="row" justifyContent="center" gap={0.5} alignItems="center">
        <ascii-font font="tiny" text="Koin" color="white" />
        <ascii-font font="tiny" text="Code" color="orange" />
      </box>

      {/* <box flexDirection="column"  gap={1}>
       

        <box flexDirection="row" gap={5} alignItems="center">
          <text fg="grey">/</text>
          <text>commands</text>
        </box>

        <box flexDirection="row" gap={5} alignItems="center">
          <text fg="grey">esc</text>
          <text>cancel</text>
        </box>
      </box> */}
    </box>
  );
};
