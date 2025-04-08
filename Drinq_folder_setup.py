import os

<<<<<<< HEAD
# Define the entire Drinq 2.0 folder structure
structure = {
    "backend": ["app", "database", "tests"],
    "frontend": ["web", "assets", "figma"],
    "docs": [],
    "": [".gitignore", "README.md", "frontend/package.json"]
}

# Content for the top-level .gitignore
=======
# Define the folder structure for Drinq
structure = {
    "backend": ["app", "database", "tests"],
    "mobile": ["DrinqApp"],
    "docs": [],
    "": [".gitignore", "README.md"]
}

# Gitignore content for Drinq
>>>>>>> 706f2eb244c227e3539e557bf004c6a7ca95b91f
gitignore_content = """# Backend
__pycache__/
*.pyc
.env

<<<<<<< HEAD
# Frontend
=======
# React Native
>>>>>>> 706f2eb244c227e3539e557bf004c6a7ca95b91f
node_modules/
android/
ios/
*.log
"""

<<<<<<< HEAD
# Content for top-level README
readme_main = "# Drinq 2.0\n\nCross-platform mobile and backend app for bar-to-customer promotions."

# Create folders and add README.md to each
for parent, subdirs_or_files in structure.items():
    for name in subdirs_or_files:
        full_path = os.path.join(parent, name)

        if '.' in name and parent == "":  # Top-level files
            with open(full_path, 'w') as f:
                if name == ".gitignore":
                    f.write(gitignore_content)
                elif name == "README.md":
                    f.write(readme_main)
                elif name == "frontend/package.json":
                    f.write('{\n  "name": "drinq-frontend",\n  "version": "1.0.0"\n}\n')
        else:
            os.makedirs(full_path, exist_ok=True)
            readme_path = os.path.join(full_path, "README.md")
            with open(readme_path, "w") as f:
                f.write(f"# {os.path.basename(full_path).capitalize()}\n\nAuto-generated folder for Drinq project.")

print("✅ Drinq 2.0 project structure created successfully.")
=======
readme_content = "# Drinq\n\nCross-platform mobile app connecting customers and bars/restaurants."

# Create folders and files
for root, subdirs in structure.items():
    for subdir in subdirs:
        if '.' in subdir:  # It's a file
            path = os.path.join(root, subdir)
            with open(path, 'w') as f:
                if subdir == ".gitignore":
                    f.write(gitignore_content)
                elif subdir == "README.md":
                    f.write(readme_content)
        else:  # It's a directory
            os.makedirs(os.path.join(root, subdir), exist_ok=True)

print("✅ Drinq project structure created.")
>>>>>>> 706f2eb244c227e3539e557bf004c6a7ca95b91f
