import React from "react";
import { View, Text } from "react-native";
import { WifiOff, RefreshCw } from "lucide-react-native";
import { useTheme } from "@/src/theme/ThemeContext";
import { Button } from "@/src/components/ui/Button";

interface Props {
  message?: string;
  onRetry: () => void;
}

export const ErrorState: React.FC<Props> = ({
  message = "Something went wrong while loading. Please try again.",
  onRetry,
}) => {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.danger + "15",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WifiOff size={26} color={colors.danger} />
      </View>
      <Text style={{ color: colors.textMain, fontSize: 16, fontWeight: "700", marginTop: 16 }}>
        Couldn&apos;t load data
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 14,
          lineHeight: 21,
          textAlign: "center",
          marginTop: 6,
          paddingHorizontal: 20,
        }}
      >
        {message}
      </Text>
      <Button
        label="Try again"
        variant="primary"
        icon={<RefreshCw size={16} color="#fff" />}
        onPress={onRetry}
        style={{ marginTop: 20 }}
        testID="error-retry-btn"
        fullWidth={false}
      />
    </View>
  );
};
