package uk.ac.bristol.uobtkd.camera;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MenuActivity extends Activity {
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setGravity(Gravity.CENTER);
    int padding = (int) (24 * getResources().getDisplayMetrics().density);
    layout.setPadding(padding, padding, padding, padding);
    CompanionLayout.respectSystemBars(layout);
    layout.setBackgroundColor(Color.rgb(16, 16, 16));
    TextView title = new TextView(this);
    title.setText("UoBTKD Companion");
    title.setTextColor(Color.WHITE);
    title.setTextSize(28);
    title.setGravity(Gravity.CENTER);
    layout.addView(title);
    TextView description = new TextView(this);
    description.setText("Connect to the desktop for judging or video replay.");
    description.setTextColor(Color.LTGRAY);
    description.setGravity(Gravity.CENTER);
    description.setPadding(0, padding / 2, 0, padding);
    layout.addView(description);
    addButton(layout, "Corner Judge", JudgeActivity.class);
    addButton(layout, "IVR Camera", MainActivity.class);
    setContentView(layout);
  }

  private void addButton(LinearLayout layout, String label, Class<?> activity) {
    Button button = new Button(this);
    button.setText(label);
    button.setOnClickListener(v -> startActivity(new Intent(this, activity)));
    layout.addView(button, new LinearLayout.LayoutParams(-1, -2));
  }
}
