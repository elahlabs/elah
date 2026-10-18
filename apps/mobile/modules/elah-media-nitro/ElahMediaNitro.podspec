require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ElahMediaNitro"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://www.elah.dev"
  s.license      = package["license"]
  s.authors      = "Elah"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/elahlabs/elah.git" }

  s.source_files = [
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]
  s.frameworks = "CoreVideo"

  load 'nitrogen/generated/ios/ElahMediaNitro+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
