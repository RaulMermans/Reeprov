from setuptools import setup, find_packages

setup(
    name="reeprov-client",
    version="0.2.0b1",
    description="Python client SDK for Reeprov — local-first debugging and reproducibility infrastructure for AI agents.",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Reeprov Contributors",
    license="Apache-2.0",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    python_requires=">=3.10",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: Apache Software License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Topic :: Software Development :: Debuggers",
        "Topic :: Software Development :: Testing",
    ],
)
