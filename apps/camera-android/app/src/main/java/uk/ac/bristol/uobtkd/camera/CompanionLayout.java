package uk.ac.bristol.uobtkd.camera;

import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

final class CompanionLayout {
  private CompanionLayout() {}

  static void respectSystemBars(View view) {
    int left = view.getPaddingLeft(), top = view.getPaddingTop();
    int right = view.getPaddingRight(), bottom = view.getPaddingBottom();
    view.setOnApplyWindowInsetsListener((target, insets) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets bars = insets.getInsets(
            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        target.setPadding(left + bars.left, top + bars.top, right + bars.right, bottom + bars.bottom);
      } else {
        target.setPadding(left + insets.getSystemWindowInsetLeft(), top + insets.getSystemWindowInsetTop(),
            right + insets.getSystemWindowInsetRight(), bottom + insets.getSystemWindowInsetBottom());
      }
      return insets;
    });
  }
}
